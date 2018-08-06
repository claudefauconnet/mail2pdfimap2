var Imap = require('imap');
var inspect = require('util').inspect;
var async = require('async');
var simpleParser = require('mailparser').simpleParser;
var fs = require('fs');
var path = require('path');
var mailPdfGenerator = require('./mailPdfGenerator');
var common = require('./common.js')
var zipdir = require('zip-dir');
var socket = require('../routes/socket.js');
var chardet = require('chardet');
var iconv = require('iconv-lite');
var execSync = require('child_process').execSync;
var libmime = require('libmime');

var host = 'imap.atd-quartmonde.org';
var port = 993;

/// pour les grosses boites : www.server.timeout = 5000*1000*1000;


process.setMaxListeners(0);
/*var host = 'imap.sfr.fr';
var port = 993;*/

var pdfArchiveDir = "./pdfs";

var skippedFolders = ["Autres utilisateurs", "Dossiers partagés"];

var imapMailExtractor = {
    deleteDirAfterZip: true,
    archivePrefix: "pdfMailArchive",
    archiveMaxSize: 1000 * 1000 * 1000,//1000MO,
    maxMessageSize: 1000 * 1000 * 5,
    maxAttachmentsSize: 1000 * 1000 * 5,

    getImapConn: function (mailAdress, password) {
        var imap = new Imap({
            user: mailAdress,
            password: password,
            host: host,
            port: port,
            connTimeout: 30000,
            authTimeout: 30000,
            tls: true
        });

        return imap;


    },


    getFolderHierarchy: function (mailAdress, password, rootFolder, callback) {

        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        var leafFolder = rootFolder;
        if (rootFolder) {
            var p = rootFolder.lastIndexOf("/");
            if (p > -1)
                leafFolder = rootFolder.substring(p + 1);
        }
        imap.once('ready', function () {
            imap.getBoxes([], function (err, result) {
                if (err)
                    return callback(err);

                var tree = [];
                var id = 1000;

                function recurse(idParent, object, ancestors) {


                    for (var key in object) {
                        if (!rootFolder || rootFolder.indexOf(key) > -1 || ancestors.indexOf(leafFolder) > -1) {

                            id += 1;
                            var ancestors2 = ancestors.slice(0);
                            ancestors2.push(key)
                            tree.push({parent: idParent, id: id, text: key, ancestors: ancestors2});

                            recurse(id, object[key].children, ancestors2)
                        }
                    }


                }

                recurse("#", result, []);


                return callback(null, tree);
            });


        }).once('error', function (err) {
            console.log('Fetch error: ' + err.message);
            callback(err.message);
        }).once('end', function () {
            imap.end();
        });
        imap.once('error', function (err) {
            console.log('Fetch error: ' + err.message);
            //   callback(err.message);
        })
        imap.connect();
    }
    ,

    decodeChunk: function (chunk) {
        var str = "";
        var encoding = chardet.detect(chunk);
//console.log(encoding);
        if (encoding.length > 0 && encoding != 'UTF-8') {
            try {
                var str = iconv.decode(chunk, encoding);
            }
            catch (e) {
                socket.message(e);
                console.log(e);
                str = chunk.toString('utf8');
            }

        }
        else {
            str = chunk.toString('utf8');
        }
        str = libmime.decodeWords(str)
        return str;
    }
    ,
    getFolderMessages: function (mailAdress, password, folder, excludedMessages, callback0) {
        var messages = [];
        messages.folderSize = 0;
        var i = 0;
        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        imap.once('ready', function () {
            imap.openBox(folder, true, function (err, box) {
                if (err) {
                    console.log(err);
                    return callback0(err)
                }


                imap.search([['!LARGER', imapMailExtractor.maxMessageSize]], function (err, results) {
                    if (results.length == 0)
                        return callback0(null, []);

                    if (excludedMessages)
                        for (var i = 0; i < excludedMessages.length; i++) {
                            var p = -1;
                            if ((p = results.indexOf(excludedMessages[i].seqno)) > -1) {
                                results.splice(p, 1);
                            }

                        }
                    console.log("results.length " + results.length);
                    //   console.log(JSON.stringify(results,0,null));
                    // var f = imap.seq.fetch('1:*', {
                    var f = imap.seq.fetch(results, {
                        bodies: '',
                        //  bodies:['TEXT', 'HEADER.FIELDS (TO FROM SUBJECT)'],
                        struct: false
                    });
                    var folderCountMessages = 1;

                    f.on('message', function (msg, seqno) {
                        //  console.log("fetch  "+count+++"  "+seqno);
                        var message = {};
                        var encoding = [];
                        var msgState = 1;
                        //  folderCountMessages+=1;
                        msg.on('body', function (stream, info) {

                            messages.folderSize += info.size;
                            if (folderCountMessages % 10 == 0) {
                                socket.message("__" + folderCountMessages + " messages read from  folder " + common.roundToKO(messages.folderSize) + "KO");
                            }
                            //  message.seqno = seqno;
                            var buffer = '';
                            stream.on('data', function (chunk) {

                                    if (msgState > 0 && info.size > imapMailExtractor.maxMessageSize) {
                                        msgState = -1;
                                        socket.message("mail exceed max size for archive " + common.roundToMO(info.size));
                                        return;
                                    }
                                    // !!!!!!!!!!!determination de l'encodage du buffer pour le transformer en UTF8
                                    buffer += imapMailExtractor.decodeChunk(chunk);

                                }
                            );
                            stream.once('end', function () {

                                buffer = buffer.replace(/charset=[a-zA-Z-0-9\-]*/g, "charset=utf8")
                                messages.push({content: buffer, seqno: seqno, bodyInfo: info.size});


                            });
                        });
                        msg.once('attributes', function (attrs) {
                            message.attributes = attrs;
                        });
                        msg.once('end', function () {
                            folderCountMessages += 1;
                            ;

                        });
                    });
                    f.once('error', function (err) {
                        socket.message("<span class='rejected'> 1 mail rejected reason :" + err.message + "</span>");
                        console.log('Fetch error: ' + err.message);
                        //  callback0(err.message);
                    });
                    f.once('end', function () {
                        console.log(folderCountMessages);
                        callback0(null, messages)
                        imap.end();

                    });
                });
            });


        });
        imap.once('error', function (err) {
            console.log('Fetch error: ' + err.message);
            //  callback0(err.message);
        })
        imap.connect();

    },
    getExcludedFolderMessages: function (mailAdress, password, folder, callback1) {
        var messages = [];
        messages.totalSize = 0;
        messages.totalValidSize = 0;
        messages.countValidMessages = 0;
        messages.countRejectedMessages = 0

        var i = 0;

        /* function findAttachmentParts(struct, attachments) {
             attachments = attachments || [];

             for (var i = 0, len = struct.length, r; i < len; ++i) {
                 if (Array.isArray(struct[i])) {
                     findAttachmentParts(struct[i], attachments);
                 } else {
                     if (struct[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(struct[i].disposition.type) > -1) {
                         attachments.push(struct[i]);

                     }

                 }
             }
             return attachments;
         }*/


        function getPartsTotalSize(part, totalSize) {

            for (var i = 0; i < part.length; ++i) {
                if (Array.isArray(part[i])) {
                    totalSize = getPartsTotalSize(part[i], totalSize);
                }
                else if (part[i].size)
                    totalSize += part[i].size;

            }
            return totalSize;


        }

        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        imap.once('ready', function () {
            imap.openBox(folder, true, function (err, box) {
                if (err) {
                    console.log(err);
                    return callback1(err)
                }


                imap.search([['LARGER', 1]], function (err, results) {
                    if (results.length == 0)
                        return callback1(null, messages);
                    var f = imap.seq.fetch(results, {
                        bodies: 'HEADER.FIELDS (SUBJECT)',
                        //  bodies: ['HEADER.FIELDS (SUBJECT)', 'TEXT'],
                        struct: true
                    });

                    f.on('message', function (msg, seqno) {
                        var message = {seqno: seqno};
                        var buffer = '';
                        //  message.seqno = seqno;
                        var subject = "";
                        msg.on('body', function (stream, info) {

                            if (info.which == 'HEADER.FIELDS (SUBJECT)') {
                                stream.on('data', function (chunk) {
                                        buffer += imapMailExtractor.decodeChunk(chunk);
                                    }
                                );
                                stream.once('end', function () {
                                    message.subject = buffer;

                                });
                            }
                        });
                        msg.once('attributes', function (attrs) {

                            var totalSize = getPartsTotalSize(attrs.struct, 0);
                            messages.totalSize += totalSize;
                            if (totalSize > imapMailExtractor.maxMessageSize) {
                                message.size = totalSize;
                                message.reject = true;
                            }
                            else {
                                messages.totalValidSize += totalSize;
                            }


                            /*  var attachments = findAttachmentParts(attrs.struct);
                              var attachmentsSize = 0;
                              for (var i = 0, len = attachments.length; i < len; ++i) {
                                  attachmentsSize += attachments[i].size;
                              }
                              if (attachmentsSize > imapMailExtractor.maxAttachmentsSize) {
                                  message.attachmentsSize = attachmentsSize;
                                  message.reject = true;
                              }*/
                        });
                        msg.once('end', function () {

//console.log( message.subject);
                            if (message.reject) {
                                messages.countRejectedMessages += 1
                                messages.push(message);
                                if (message.size)
                                    socket.message("<span class='rejected'>mail too large : " + common.roundToMO(message.size) + " MO. , " + message.subject + "</span>")
                             // socket.message("<span class='rejected'>mail too large : " + common.roundToMO(message.size) + " MO , " + message.subject + "</span>")
                                // if (message.attachmentsSize)
                                //   socket.message("<span class='rejected'>mail attachments too large : " + common.roundToMO(message.attachmentsSize) + " , " + message.subject + "</span>")
                            }
                            messages.countValidMessages += 1;
                        });


                    });
                    f.once('error', function (err) {
                        console.log('Fetch error: ' + err.message);
                        // return callback1(null);
                    });
                    f.once('end', function () {
                        return callback1(null, messages)
                        imap.end();
                    });
                });
            });


        })
        imap.once('error', function (err) {
            console.log('Fetch error: ' + err.message);
            //   return callback1(err.message);
        })
        imap.connect();

    },


    generateFolderHierarchyMessages: function (mailAdress, password, rootFolder, withAttachments, scanOnly, callback) {
        var archivePath = null;
        var leafFolder = rootFolder;
        var archiveValidSize = 0;
        var archiveTotalSize = 0;
        var totalMails = 0;
        var archiveTotalValidMails = 0;
        var archiveTotalRejectedMails = 0;
        var startTime = new Date();

        if (rootFolder) {
            var p = rootFolder.lastIndexOf("/");
            if (p > -1)
                leafFolder = rootFolder.substring(p + 1);
        }
        var message = " start extracting messages from " + leafFolder;
        socket.message(message);


        //set pdf files root path
        var pdfArchiveRootPath = pdfArchiveDir + "/" + imapMailExtractor.archivePrefix + "_" + mailAdress + "_" + Math.round(Math.random() * 100000);
        pdfArchiveRootPath = path.resolve(pdfArchiveRootPath);
        if (!fs.existsSync(pdfArchiveRootPath)) {
            fs.mkdirSync(pdfArchiveRootPath);
        }


        imapMailExtractor.getFolderHierarchy(mailAdress, password, rootFolder, function (err, folders) {
            var output = [];


            async.eachSeries(folders, function (folder, callbackEachFolder) {
                //  console.log("--------" + folder.text)
                // on ne traite pas les boites partagées (fausses racinbes qui font planter)
                if (skippedFolders.indexOf(folder.text) > -1) {
                    return callbackEachFolder();
                }

                //on ne traite pas  les dossiers parents
                if (folder.text != leafFolder && folder.ancestors.indexOf(leafFolder) < 0)
                    return callbackEachFolder();


                var box = "";
                for (var i = 0; i < folder.ancestors.length; i++) {
                    if (i > 0)
                        box += "/";
                    box += folder.ancestors[i];
                }

                var text = " looking for mails in folder " + folder.text;
                socket.message(text);

                var excludedMessages = [];
                var validMessages = []
                async.series([

                    function (callbackSerie) {// selection des mails à exclure
                        imapMailExtractor.getExcludedFolderMessages(mailAdress, password, box, function (err, messages) {
                            if (err) {
                                return callbackSerie(err);
                            }


                            archiveValidSize += messages.totalValidSize;
                            archiveTotalSize += messages.totalSize;

                            archiveTotalValidMails += messages.countValidMessages;
                            archiveTotalRejectedMails += messages.length;



                            if(scanOnly){
                                var text = " <B>"+
                                    " count :"+messages.countValidMessages+"/"+(messages.length+messages.countValidMessages)+
                                    " size :"+common.roundToMO(messages.totalValidSize)+"/"+common.roundToMO(messages.totalSize)+" MO.";

                                socket.message(text);
                            }

                            if (archiveValidSize > imapMailExtractor.archiveMaxSize) {
                                var text = "Operation aborted : maximum size of archive reached :" + Math.round(archiveValidSize / 1000000) + "/" + Math.round(imapMailExtractor.archiveMaxSize / 1000000) + "MO"
                                socket.message(text);
                                imapMailExtractor.deleteFolderRecursive(pdfArchiveRootPath);
                                return callbackSerie2(text);


                            }

                            excludedMessages = messages;
                            return callbackSerie(null, excludedMessages);
                        })
                    },


                    function (callbackSerie2) {//extraction des mails bruts


                        if (scanOnly) {

                            return callbackSerie2(null);

                        }
                        imapMailExtractor.getFolderMessages(mailAdress, password, box, excludedMessages, function (err, messages) {

                            if (err) {
                                return callbackSerie2(err);
                            }
                            validMessages = messages;

                            return callbackSerie2(null, excludedMessages);
                        })
                    },
                    function (callbackSerie3) {// génération des pdfs
                        if (scanOnly) {

                            return callbackSerie3(null);

                        }

                        if (box.indexOf(leafFolder) < 0) {
                            return callbackSerie3(null, 0)
                        }

                        var message = " <B>Processing " + validMessages.length + " emails in " + folder.text + "</B>";
                        socket.message(message);
                        var xx = 1;
                        var folderMessages = {
                            folder: folder.text,
                            ancestors: folder.ancestors,
                            messages: [],
                            root: leafFolder
                        }
                        folderMessages.messages = validMessages;

                        imapMailExtractor.createFolderPdfs(pdfArchiveRootPath, folderMessages, withAttachments, function (err, result) {

                            if (err) {
                                return callbackSerie3(err)
                            }

                            totalMails += result;

                            return callbackSerie3();
                        });
                        // output.push(folderMessages);


                    }
                ], function (err, result) {
                    if (err) {
                        return callbackEachFolder(err)
                    }
                    //  totalMails += result.length;
                    return callbackEachFolder();
                })//end  getFolderMessages
                //  });//end getExcludedAttachmentsFolderMessages
                //  }); //end  getExcludedFolderMessages


            }, function (err) {// endEachFolder
                var totalDuration = Math.round((new Date() - startTime) / 1000);
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                if (scanOnly) {
                    return callback(null, {

                        text: "Archive scan  OK :" +
                        "<br>Total mails  :" + (archiveTotalValidMails + archiveTotalRejectedMails) +
                        "<br>Total valid mails  :" + archiveTotalValidMails +
                        "<br>Total rejected mails  :" + archiveTotalRejectedMails +
                        "<br>initial archive size  :" + common.roundToMO(archiveTotalSize) + "MO" +
                        "<br>valid archive size  :" + common.roundToMO(archiveValidSize) + "MO"

                    })
                }
                return callback(null, {

                    text: "Total mails Processed :" + totalMails + "in " + totalDuration + "sec, preparing zip download, size:" + common.roundToMO(archiveValidSize) + "MO",
                    pdfArchiveRootPath: pdfArchiveRootPath
                })
            })


        })

    }
    ,

    createFolderPdfs: function (pdfArchiveRootPath, folderMessages, withAttachments, callback) {


        var start = folderMessages.ancestors.indexOf(folderMessages.root)
        if (start < 0)
            return callback(null, 0);

        for (var i = start; i < folderMessages.ancestors.length; i++) {

            pdfArchiveRootPath += "/" + folderMessages.ancestors[i];
            var dir = path.resolve(pdfArchiveRootPath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }

        }

        //end set pdf files path


        async.eachSeries(folderMessages.messages, function (rawMessage, callbackEachMail) {


                var bodyInfo = rawMessage.bodyInfo;
                var seqno = rawMessage.seqno;
                simpleParser(rawMessage.content, function (err, mail) {

                    if (err) {
                        console.log(err);
                        return callbackEachMail(err);
                    }


                    mailPdfGenerator.createMailPdf(pdfArchiveRootPath, mail, withAttachments, function (err, result) {
                        if (err) {


                            console.log(err);
                            console.log("ERR " + mail.subject)
                            //   return callbackEachMail(err);
                        } else {

                        }
                        return callbackEachMail(null);


                    })
                });

            }, function (err) {
                if (err) {
                    console.log(err);
                    return callback(err);
                }

                return callback(null, folderMessages.messages.length);
            }
        );


    }

    ,
    downloadArchive: function (mailAdress, pdfArchiveRootPath, response) {


        socket.message("transforming pdfs to version 1.5...");
        var pdfArchiveRootPath_1_5 = imapMailExtractor.toPDF_1_5_Folder(pdfArchiveRootPath);
        var dir = path.resolve(pdfArchiveRootPath_1_5);
        //  socket.message("download pdfMailArchive-" + pdfArchiveRootPath + " STARTED");
        socket.message("creating  zip file on server and start download...");
        zipdir(dir, function (err, buffer) {
            if (err)
                return callback(err);

            response.setHeader('Content-type', 'application/zip');
            response.setHeader("Content-Disposition", "attachment;filename=" + imapMailExtractor.archivePrefix + "-" + mailAdress + ".zip");
            response.send(buffer);
            socket.message("download pdfMailArchive-" + imapMailExtractor.archivePrefix + "-" + mailAdress + " DONE");
            if (imapMailExtractor.deleteDirAfterZip)
                imapMailExtractor.deleteFolderRecursive(dir);

        });

    },

    toPDF_1_5_Folder: function (rootDir) {
        function recurse(path, newPath) {
            if (fs.existsSync(path)) {

                fs.readdirSync(path).forEach(function (file, index) {
                    var curPath = path + "/" + file;
                    var curNewPath = newPath + "/" + file;
                    if (fs.lstatSync(curPath).isDirectory()) {
                        if (!fs.existsSync(newPath)) {
                            fs.mkdirSync(newPath);
                        }
                        if (!fs.existsSync(curNewPath)) {
                            fs.mkdirSync(curNewPath);
                        }
                        recurse(curPath, curNewPath);
                    }
                    else {
                        try {
                            imapMailExtractor.toPDF_1_5_File(curPath, curNewPath);
                        }
                        catch (e) {
                            fs.copyFileSync(curPath, curNewPath)
                            console.log(e);
                            var text = "<span class='rejected'><B> !!! cannot convert pdf file  to version 1.5 :" + file + "</span>"
                            socket.message(text);

                        }

                    }


                });

            }


        }

        var newRootDir = rootDir + "_1.5"
        recurse(rootDir, newRootDir);
        imapMailExtractor.deleteFolderRecursive(rootDir)
        return newRootDir;
    }

    ,
    toPDF_1_5_File: function (inputFile, outputFile) {
//https://www.npmjs.com/package/ghostscript-js
        //  gswin64.exe -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dBATCH -sOutputFile=D:\GitHub\mail2pdfImap\pdfs\claude.fauconnet@atd-quartmonde.org_23679\testMail2Pdf\technique\moteurDerecherche\test2.pdf D:\GitHub\mail2pdfImap\pdfs\claude.fauconnet@atd-quartmonde.org_23679\testMail2Pdf\technique\moteurDerecherche\test.pdf

        var ghostscriptExe = "gs";
        if (path.sep == "\\")//windows
            ghostscriptExe = "\"C:\\Program Files\\gs\\gs9.21\\bin\\gswin64.exe\""

        var cmd = ghostscriptExe + " -sDEVICE=pdfwrite  -sPAPERSIZE=a4 -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dBATCH -sOutputFile=\"" + outputFile + "\" \"" + inputFile + "\"";
        //  var cmd = ghostscriptExe + " -sDEVICE=pdfwrite  -sPAPERSIZE=a4 -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dNODISPLAY -dBATCH  -sOutputFile=\"" + outputFile + "\" \"" + inputFile+"\"";


        //   dNOPAGEPROMPT
        //  console.log("EXECUTING " + cmd)
        execSync(cmd, function (err, stdout, stderr) {
            if (err) {

                return;

            }

        });

    }


    ,
    deleteFolderRecursive: function (path, isChild) {
        if (!isChild && path.indexOf(imapMailExtractor.archivePrefix) < 0) {
            console.log("!!!!!!!!!!!!refuse to delete dir other than pdfMailArchive...")
            return;
        }

        if (fs.existsSync(path)) {
            fs.readdirSync(path).forEach(function (file, index) {
                var curPath = path + "/" + file;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    imapMailExtractor.deleteFolderRecursive(curPath, true);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
            try {
                fs.rmdirSync(path);
            }
            catch (e) {
                console.log(e);
            }
        }
    }
}


module.exports = imapMailExtractor;

var options = {
    user: "claude.fauconnet@atd-quartmonde.org",
    password: "fc6kDgD8"

}
if (false) {
    //   imapMailExtractor.getFolderMessages(options.user, options.password, "Autres utilisateurs/administration.cijw", function (err, result) {
    imapMailExtractor.getFolderMessages(options.user, options.password, "Dossiers partagés/ecritheque", [], function (err, result) {

    })


}
if (false) {
    pdfArchiveDir = "D:\\GitHub\\mail2pdfImap\\pdfs\\"
    imapMailExtractor.generateFolderHierarchyMessages(options.user, options.password, "Dossiers partagés/archives.cjw/02-Versements/2018", false, function (err, result) {
        if (err)
            console.log(err);
        console.log(result.message)
    })


}

if (false) {

    pdfArchiveDir = "D:\\GitHub\\mail2pdfImap\\pdfs\\"
    imapMailExtractor.generateFolderHierarchyMessages(options.user, options.password, "testMail2Pdf/pb", null, function (err, result) {

    })
}
if (false) {
    imapMailExtractor.toPDF_1_5_Folder("D:\\mailspdf1.3")
}
