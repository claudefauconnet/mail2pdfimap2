var imapController = (function () {
    var self = {};
    self.currentState = "";
    self.currentFolder = "";
    self.storedImapServer ;
    self.storedMailAdress;
    var serverUrl = "./imap"

    self.onLoadPage = function () {
        self.storedImapServer = localStorage.getItem("mail2pdf_imapServer");
        self.storedMailAdress = localStorage.getItem("mail2pdf_mailAdress");
        $("#imapServer").val(self.storedImapServer || "")
        $("#mailInput").val(self.storedMailAdress || "")
        var url = window.location.href;
        var p = url.indexOf('/index');
        url = url.substring(0, p);
        var socket = io();
        socket.on('connect', function (data) {
            socket.emit('join', 'Hello World from client');
        });
        socket.on('messages', function (message) {

            if (!message || message.length == 0)
                return;
            if (message.indexOf("__") == 0) {
                return $("#messageDiv3").html("<i>" + message.substring(2) + "<i>");
            }
            if (imapController.currentState == "ARCHIVE_PROCESSING")
                $("#messageDiv2").prepend(message + "<br>");
            else {
                $("#messageDiv").html(message);
                $("#messageDiv2").prepend(message + "<br>");
            }
        })
    }


    self.loadTreeHierarchy = function () {



        $("#waitImg").css("visibility", "visible")
        var payload = {
            getFolderHierarchy: 1,
            //   rootFolder: "testMail2Pdf",
            mailAdress: $("#mailInput").val(),
            password: $("#passwordInput").val(),
            imapServer: $("#imapServer").val()
        }

        $.ajax({
            type: "POST",
            url: serverUrl,
            data: payload,
            dataType: "json",
            success: function (data, textStatus, jqXHR) {
                $("#waitImg").css("visibility", "hidden")
                if (data.length == 0) {
                    return;

                }

                if ($("#imapServer").val() != self.storedImapServer)
                    localStorage.setItem("mail2pdf_imapServer", $("#imapServer").val())
                if ($("#mailInput").val() != self.storedMailAdress)
                    localStorage.setItem("mail2pdf_mailAdress", $("#mailInput").val())



                self.currentState = "OPENED";
                $("#messageDiv").html("Select a box to process");

                $('#jstreeDiv').jstree({
                    'core': {
                        'data': data
                    }
                }).on('loaded.jstree', function () {
                    $('#jstreeDiv').jstree('open_all');
                }).on('changed.jstree', function (e, data) {
                    var i, j, r = [];
                    var str = ""
                    for (i = 0; i < data.node.parents.length; i++) {

                        var parentNode = $('#jstreeDiv').jstree(true).get_node("" + data.node.parents[i]);
                        console.log(parentNode.text)
                    }

                    ;

                    $("#generateFolderPdfArchive").css("visibility", "hidden");
                    $("#generateFolderPdfArchiveButton").css("visibility", "hidden");
                    $("#scanFolderPdfArchiveButton").css("visibility", "visible");
                    $("#generateFolderPdfArchiveWithAttachmentButton").css("visibility", "hidden");
                    $("#downloadJournalButton").css("visibility", "hidden");

                    $("#messageDiv2").html("");
                    $("#messageDiv3").html("");
                    $("#messageDiv").html(data.node.text + " selected");


                })
            },
            error: function (err) {
                $("#waitImg").css("visibility", "hidden")
                console.log(err);
                self.currentState = "";
                $("#messageDiv").html("ERROR " + err.responseText);
            }
        })


    }

    self.getJsTreeSelectedNodes = function (dontCleanMessages) {
        var selectedData = [];
        var selectedIndexes;
        if (!dontCleanMessages) {
            $("#messageDiv2").html("");
            $("#messageDiv3").html("");
        }
        //  $("#messageDiv").html("");
        selectedIndexes = $("#jstreeDiv").jstree("get_selected", true);
        jQuery.each(selectedIndexes, function (index, value) {
            selectedData.push(selectedIndexes[index]);
        });
        self.currentFolder = selectedData[0].text;
        return selectedData;
    }

    self.scanFolderPdfArchive = function () {
        self.generateFolderPdfArchive(false, true);

    }


    self.indexMails = function (withAttachments, scanOnly) {

var index=prompt("Enter index name");
if(!index || index=="")
    return
        var selectedNodes = self.getJsTreeSelectedNodes();
        if (selectedNodes.length == 0) {
            return alert("select a root folder first");
        }
        $("#messageDiv3").html("Processing...");
        $("#messageDiv2").html("");
        $("#messageDiv").html("");
        $("#waitImg").css("visibility", "visible")
        self.currentState = "ARCHIVE_PROCESSING";
        //  var folder = selectedNodes[0];
        var folderPathes = [];
        var folderIds = [];
        selectedNodes.forEach(function(folder){
            var folderPath=""
            for (var i = 0; i < folder.original.ancestors.length; i++) {
                if (i > 0)
                    folderPath += "/";
                folderPath += folder.original.ancestors[i];
            }
            folderPathes.push(folderPath)
            folderIds.push(folder.id)
        })
        var payload = {
            generateMultiFoldersHierarchyMessages: 1,
            rootFolders: folderPathes,
            mailAdress: $("#mailInput").val(),
            password: $("#passwordInput").val(),
            imapServer: $("#imapServer").val(),
            folderIds: folderIds,

            indexElastic:index,

        }


        $.ajax({
            type: "POST",
            url: serverUrl,
            data: payload,
            timeout: 1000 * 3600 * 2,
            dataType: "json",
            success: function (data, textStatus, jqXHR) {
                self.currentState ="_done" ;
                $("#waitImg").css("visibility", "hidden");
                $("#messageDiv3").html("<B>" + "Indexation DONE" + "</B>");
            },
            error: function (err, status) {

                console.log(status);
                $("#waitImg").css("visibility", "hidden")
                console.log(err);
                self.currentState = "";
                $("#messageDiv").html("ERROR : " + err.responseText);
            }
        })


    }



    self.generateFolderPdfArchive = function (withAttachments, scanOnly) {


        var selectedNodes = self.getJsTreeSelectedNodes();
        if (selectedNodes.length == 0) {
            return alert("select a root folder first");

        }
        $("#messageDiv3").html("Processing...");
        $("#messageDiv2").html("");
        $("#messageDiv").html("");
        $("#waitImg").css("visibility", "visible")
        self.currentState = "ARCHIVE_PROCESSING";
        var folder = selectedNodes[0];
        var folderPath = "";
        for (var i = 0; i < folder.original.ancestors.length; i++) {
            if (i > 0)
                folderPath += "/";
            folderPath += folder.original.ancestors[i];
        }
        var payload = {
            generateFolderHierarchyMessages: 1,
            rootFolder: folderPath,
            mailAdress: $("#mailInput").val(),
            password: $("#passwordInput").val(),
            imapServer: $("#imapServer").val(),
            folderId: folder.id

        }
        if (scanOnly)
            payload.scanOnly = true
        if (withAttachments)
            payload.withAttachments = true;

        $.ajax({
            type: "POST",
            url: serverUrl,
            data: payload,
            timeout: 1000 * 3600 * 2,
            dataType: "json",
            success: function (data, textStatus, jqXHR) {


                self.currentState = "ARCHIVE_DONE";
                $("#waitImg").css("visibility", "hidden");
                $("#downloadJournalButton").css("visibility", "visible")


                $("#messageDiv3").html("<B>" + data.text + "</B>");

                if (scanOnly) {
                    //  self.downloadJournal();
                    var status = data.status;
                    var WithAttachmentButtonState = true;
                    var messagesOnlyButtonState = true;
                    if (status == "ko") {
                        WithAttachmentButtonState = true;
                        messagesOnlyButtonState = true;


                    }
                    else if (status == "okMessagesOnly") {
                        WithAttachmentButtonState = true;
                        messagesOnlyButtonState = false;
                    }
                    else if (status == "okAll") {
                        WithAttachmentButtonState = false;
                        messagesOnlyButtonState = false;
                    }
                    $("#generateFolderPdfArchive").css("visibility", "visible")
                    $("#generateFolderPdfArchiveButton").css("visibility", "visible")
                    $("#generateFolderPdfArchiveWithAttachmentButton").css("visibility", "visible")
                    $("#generateFolderPdfArchiveButton").prop('disabled', messagesOnlyButtonState);
                    $("#generateFolderPdfArchiveWithAttachmentButton").prop('disabled', WithAttachmentButtonState);


                    return;
                }

                if (data.length == 0) {
                    return;

                }
                setTimeout(function () {// time to effectivly write files on server (if zip is incomplete and delete dir fails ( not empty)
                    self.downloadArchive(data.pdfArchiveRootPath)
                }, 3000)


            },
            error: function (err, status) {

                console.log(status);
                $("#downloadJournalButton").css("visibility", "visible")
                $("#waitImg").css("visibility", "hidden")
                console.log(err);
                self.currentState = "";
                $("#messageDiv").html("ERROR : " + err.responseText);
            }
        })


    }


    self.downloadArchive = function (pdfArchiveRootPath) {


        var payload = {
            downloadArchive: 1,
            pdfArchiveRootPath: pdfArchiveRootPath,
            mailAdress: $("#mailInput").val(),

        }
        // Build a form
        var form = $('<form></form>').attr('action', serverUrl).attr('method', 'post');
        // Add the one key/value
        for (var key in payload) {
            form.append($("<input></input>").attr('type', 'hidden').attr('name', key).attr('value', payload[key]));
        }
        //send request
        form.appendTo('body').submit().remove();
    };


    self.downloadJournal = function () {
        var html = $("#messageDiv3").html() + "<br>" + $("#messageDiv2").html();

        var selectedNodes = self.getJsTreeSelectedNodes(true);
        var folder = selectedNodes[0];
        var user = $("#mailInput").val()
        var date = "" + new Date();

        var style = "<style>\n" +
            "        body {\n" +
            "            font-family: Verdana;\n" +
            "            font-size: 12px;\n" +
            "        }\n" +
            "        .rejected {\n" +
            "            font-style: italic;\n" +
            "            color: red;\n" +
            "        }\n" +
            "    </style>"
        var content = "<html><head>" + style + "</head><body>Date :" + date.substring(0, date.indexOf("(")) + "<br>"
        content += "User :" + user + "<br>";
        // content+="Folder :"+folder+"<br>";
        content += html;
        content += "</body></html>";

        var payload = {
            downloadJournal: 1,
            content: content,
        }
        // Build a form
        var form = $('<form></form>').attr('action', serverUrl).attr('method', 'post');
        // Add the one key/value
        for (var key in payload) {
            form.append($("<input></input>").attr('type', 'hidden').attr('name', key).attr('value', payload[key]));
        }
        //send request
        form.appendTo('body').submit().remove();
    };


    return self;


})()
