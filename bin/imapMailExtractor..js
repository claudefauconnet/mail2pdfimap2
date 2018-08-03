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
    archivePrefix:"pdfMailArchive",
    archiveMaxSize: 1000 * 1000 * 200,//50MO,
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
            callback(err.message);
        })
        imap.connect();
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

                    // console.log(results.length);

                    var f = imap.seq.fetch(results, {
                        bodies: '',
                        //  bodies:['TEXT', 'HEADER.FIELDS (TO FROM SUBJECT)'],
                        struct: false
                    });

                    f.on('message', function (msg, seqno) {
                        var message = {};
                        var encoding = [];
                        var msgState = 1;
                        //  message.seqno = seqno;
                        msg.on('body', function (stream, info) {
                            messages.folderSize += info.size;
                            //  console.log(info.size);

                            var buffer = '';
                            stream.on('data', function (chunk) {
                                    if (msgState > 0 && info.size > imapMailExtractor.maxMessageSize) {
                                        msgState = -1;
                                        socket.message("mail exceed max size for archive " + common.roundToMO(info.size));
                                        return;
                                    }
                                    // !!!!!!!!!!!determination de l'encodage du buffer pour le transformer en UTF8
                                    encoding = chardet.detectAll(chunk);
                                    //   console.log(encoding[0].name + " " + encoding[1].name);
                                    if (encoding.length > 0 && encoding[0].name != 'UTF-8') {
                                        try {
                                            var str = iconv.decode(chunk, encoding[0].name);
                                            buffer += str;
                                        }
                                        catch (e) {
                                            socket.message(e.error);
                                            console.log(e);
                                            buffer += chunk.toString('utf8');
                                        }

                                    }
                                    else {
                                        buffer += chunk.toString('utf8');
                                    }

                                }
                            );
                            stream.once('end', function () {
                                //!!!!!!!!!!! on remplace   charset=windows-1252; lencodage du corps du texte par utf8 sinon mailparser ne fonctionne pas correctement : node_modules/mail-parser.js line 674

                                buffer = buffer.replace(/charset=[a-zA-Z-0-9\-]*/g, "charset=utf8")
                                messages.push({content: buffer, seqno: seqno, bodyInfo: info.size});


                            });
                        });
                        msg.once('attributes', function (attrs) {
                            message.attributes = attrs;
                        });
                        msg.once('end', function () {


                        });
                    });
                    f.once('error', function (err) {
                        console.log('Fetch error: ' + err.message);
                        //  callback0(err.message);
                    });
                    f.once('end', function () {
                        callback0(null, messages)
                        imap.end();
                    });
                });
            });


        });
        imap.once('error', function (err) {
            console.log('Fetch error: ' + err.message);
            callback0(err.message);
        })
        imap.connect();

    },
    getExcludedFolderMessages: function (mailAdress, password, folder, callback1) {
        var messages = [];

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
                        return callback1(null, []);
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
                                        buffer += chunk.toString('utf8');
                                    }
                                );
                                stream.once('end', function () {
                                    message.subject = buffer;

                                });
                            } else if (info.which == 'TEXT') {
                                if (info.size > imapMailExtractor.maxMessageSize) {
                                    message.size = info.size;
                                    message.reject = true;
                                    messages.push(message);

                                }

                            }
                        });
                        msg.once('attributes', function (attrs) {

                            var totalSize = getPartsTotalSize(attrs.struct, 0);
                            if (totalSize > imapMailExtractor.maxMessageSize) {
                                message.size = totalSize;
                                message.reject = true;
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


                            if (message.reject) {
                                messages.push(message);
                                if (message.size)
                                    socket.message("<span class='rejected'>mail too large : " + common.roundToMO(message.size) + " , " + message.subject + "</span>")
                                // if (message.attachmentsSize)
                                //   socket.message("<span class='rejected'>mail attachments too large : " + common.roundToMO(message.attachmentsSize) + " , " + message.subject + "</span>")
                            }
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
            return callback1(err.message);
        })
        imap.connect();

    },
    getExcludedAttachmentsFolderMessages: function (mailAdress, password, folder, callback2) {

        function findAttachmentParts(struct, attachments) {
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
        }

        var messages = [];
        messages.folderSize = 0;
        var i = 0;
        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        imap.once('ready', function () {
                imap.openBox(folder, true, function (err, box) {
                    if (err) {
                        console.log(err);
                        return callback2(err)
                    }

                    imapMailExtractor.maxMessageSize = 1000;
                    imap.search([['!LARGER', imapMailExtractor.maxMessageSize]], function (err, results) {
                        /*  if (results.length == 0)
                              return callback2(null, []);*/
                        var f = imap.seq.fetch(results, {
                            bodies: 'HEADER.FIELDS (SUBJECT)',
                            struct: true
                        });

                        f.on('message', function (msg, seqno) {
                            var message = {seqno: seqno}

                            var maxAttachmentsSize = 0;
                            //  message.seqno = seqno;
                            msg.on('body', function (stream, info) {
                                var buffer = '';
                                stream.on('data', function (chunk) {
                                        buffer += chunk.toString('utf8');
                                    }
                                );
                                stream.once('end', function () {
                                    message.subject = buffer;

                                });


                                f.once('error', function (err) {
                                    console.log('Fetch error: ' + err.message);
                                    callback2();
                                });
                                f.once('end', function () {
                                    callback2(null, messages)
                                    imap.end();
                                });
                                msg.once('attributes', function (attrs) {
                                    var attachments = findAttachmentParts(attrs.struct);
                                    var attachmentsSize = 0;
                                    for (var i = 0; i < attachments.length; ++i) {
                                        attachmentsSize += attachments[i].size;
                                    }
                                    message.attachmentsSize = attachmentsSize;

                                });
                                msg.once('end', function () {

                                    if (message.attachmentsSize > imapMailExtractor.maxAttachmentsSize) {
                                        messages.push(message);
                                        socket.message("<span class='rejected'> mail attachments too large : " + message.attachmentsSize + " , " + message.subject + "</span>")
                                    }

                                });
                            });
                            f.once('error', function (err) {
                                console.log('Fetch error: ' + err.message);
                                //   return callback2(err.message);
                            });
                            f.once('end', function () {
                                callback2(null, messages)
                                imap.end();
                            });
                        });


                    });
                });


            }
        )
        imap.connect();

    },


    generateFolderHierarchyMessages: function (mailAdress, password, rootFolder, withAttachments, callback) {
        var archivePath = null;
        var leafFolder = rootFolder;
        var archiveSize = 0;
        if (rootFolder) {
            var p = rootFolder.lastIndexOf("/");
            if (p > -1)
                leafFolder = rootFolder.substring(p + 1);
        }
        var message = " start extracting messages from " + leafFolder;
        socket.message(message);
        var totalMails = 0;
        var startTime = new Date();


        //set pdf files root path
        var pdfArchiveRootPath = pdfArchiveDir + "/" + imapMailExtractor.archivePrefix+"_"+mailAdress + "_" + Math.round(Math.random() * 100000);
        pdfArchiveRootPath = path.resolve(pdfArchiveRootPath);
        if (!fs.existsSync(pdfArchiveRootPath)) {
            fs.mkdirSync(pdfArchiveRootPath);
        }


        imapMailExtractor.getFolderHierarchy(mailAdress, password, rootFolder, function (err, folders) {
            var output = [];


            async.eachSeries(folders, function (folder, callbackEachFolder) {
                console.log("--------" + folder.text)
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

                var message = " Processing from server in folder and subfolders " + folder.text;


                var excludedMessages = [];
                var validMessages = []
                async.series([

                    function (callbackSerie) {// selection des mails à exclure
                        imapMailExtractor.getExcludedFolderMessages(mailAdress, password, box, function (err, _excludedMessages) {
                            if (err) {
                                return callbackSerie(err);
                            }
                            excludedMessages = _excludedMessages;
                            return callbackSerie(null, excludedMessages);
                        })
                    },


                    function (callbackSerie2) {//extraction des mails bruts
                        imapMailExtractor.getFolderMessages(mailAdress, password, box, excludedMessages, function (err, messages) {

                            if (err) {
                                return callbackSerie2(err);
                            }
                            validMessages = messages;
                            return callbackSerie2(null, excludedMessages);
                        })
                    },
                    function (callbackSerie3) {// génération des pdfs

                        if (validMessages.folderSize)
                            archiveSize += validMessages.folderSize;
                        if (archiveSize > imapMailExtractor.archiveMaxSize) {
                            var text = "Operation aborted : maximum size of archive reached :" + Math.round(archiveSize / 1000000) + "/" + Math.round(imapMailExtractor.archiveMaxSize / 1000000) + "MO"
                            socket.message(text);
                            imapMailExtractor.deleteFolderRecursive(pdfArchiveRootPath);
                            return callbackSerie3(text);


                        }

                        else {
                            if (box.indexOf(leafFolder) < 0) {
                                return callbackSerie3(null, 0)
                            }
                            /* if (messages.length == 0) {
                                 return callbackSerie();
                             }*/
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
                                var duration = (new Date() - startTime) / 1000
                                socket.message("__total valid mail processed : " + totalMails + " in " + duration + "secs.")
                                return callbackSerie3();
                            });
                            // output.push(folderMessages);

                        }

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
                //  clearTimeout(progressMessageFn);
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                return callback(null, {
                    text: "Total mails Processed" + totalMails + " preparing zip download, size:" + common.roundToMO(archiveSize) + "MO",
                    pdfArchiveRootPath: pdfArchiveRootPath
                })
            })


        })

    }
    ,

    createFolderPdfs: function (pdfArchiveRootPath, folderMessages, withAttachments, callback) {

        /* var date = new Date();
         var senderDateDir = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + (date.getDate());

         pdfDirPath += "/" + senderDateDir;
         var dir = path.resolve(pdfDirPath);
         if (!fs.existsSync(dir)) {
             fs.mkdirSync(dir);
         }*/


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
        var folderMailSubjects = {};

        async.eachSeries(folderMessages.messages, function (rawMessage, callbackEachMail) {
                var bodyInfo = rawMessage.bodyInfo;
                var seqno = rawMessage.seqno;
                simpleParser(rawMessage.content, function (err, mail) {

                    if (err) {
                        console.log(err);
                        return callbackEachMail(err);
                    }
                    // process subjects to avoid duplicates
                    if (!mail.subject)
                        mail.subject = "subject missing";
                    if (folderMailSubjects[mail.subject]) {
                        folderMailSubjects[mail.subject] += 1;
                        mail.subject += "-" + folderMailSubjects[mail.subject]
                    } else
                        folderMailSubjects[mail.subject] = 0;

                    // console.log(mail.subject);


                    mailPdfGenerator.createMailPdf(pdfArchiveRootPath, mail, withAttachments, function (err, result) {
                        if (err) {
                            console.log(err);
                            //   return callbackEachMail(err);
                        }
                        return callbackEachMail(null);


                    })
                });

            }, function (err) {
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                // console.log(JSON.stringify(folderMailSubjects, null, 2))
                return callback(null, folderMessages.messages.length);
            }
        );


    }

    ,
    downloadArchive: function (mailAdress, pdfArchiveRootPath, response) {

        socket.message("download pdfMailArchive-" + pdfArchiveRootPath + " STARTED");

        var pdfArchiveRootPath_1_5= imapMailExtractor.toPDF_1_5_Folder (pdfArchiveRootPath) ;
        var dir = path.resolve(pdfArchiveRootPath_1_5);

        zipdir(dir, function (err, buffer) {
            if (err)
                return callback(err);

            response.setHeader('Content-type', 'application/zip');
            response.setHeader("Content-Disposition", "attachment;filename="+imapMailExtractor+"-" + mailAdress + ".zip");
            response.send(buffer);
            socket.message("download pdfMailArchive-" + pdfArchiveRootPath + " DONE");
            if (imapMailExtractor.deleteDirAfterZip)
                imapMailExtractor.deleteFolderRecursive(dir);

        });

    },

    toPDF_1_5_Folder: function (rootDir) {
        function recurse(path,newPath) {
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
                       imapMailExtractor.toPDF_1_5_File(curPath,curNewPath);

                    }


                });

            }


        }
        var newRootDir=rootDir+"_1.5"
        recurse(rootDir, newRootDir);
        imapMailExtractor.deleteFolderRecursive(rootDir)
        return  newRootDir;
    }

    ,
        toPDF_1_5_File: function (inputFile,outputFile) {
//https://www.npmjs.com/package/ghostscript-js
            //  gswin64.exe -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dBATCH -sOutputFile=D:\GitHub\mail2pdfImap\pdfs\claude.fauconnet@atd-quartmonde.org_23679\testMail2Pdf\technique\moteurDerecherche\test2.pdf D:\GitHub\mail2pdfImap\pdfs\claude.fauconnet@atd-quartmonde.org_23679\testMail2Pdf\technique\moteurDerecherche\test.pdf

            var ghostscriptExe = "gs";
            if (path.sep == "\\")//windows
                ghostscriptExe = "\"C:\\Program Files\\gs\\gs9.21\\bin\\gswin64.exe\""

         var cmd = ghostscriptExe + " -sDEVICE=pdfwrite  -sPAPERSIZE=a4 -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dBATCH -sOutputFile=\"" + outputFile + "\" \"" + inputFile+"\"";
          //  var cmd = ghostscriptExe + " -sDEVICE=pdfwrite  -sPAPERSIZE=a4 -dCompatibilityLevel=1.5 -dNOPAUSE -dQUIET -dNODISPLAY -dBATCH  -sOutputFile=\"" + outputFile + "\" \"" + inputFile+"\"";


         //   dNOPAGEPROMPT
          //  console.log("EXECUTING " + cmd)
            execSync(cmd, function (err, stdout, stderr) {
                if (err) {
                    socket.message(err);
                    return;

                }

            });

        }


    ,
        deleteFolderRecursive: function (path,isChild) {
            if(!isChild && path.indexOf(imapMailExtractor.archivePrefix)!=0) {
                console.log ("!!!!!!!!!!!!refuse to delete dir other than pdfMailArchive...")
                return;
            }

            if (fs.existsSync(path)) {
                fs.readdirSync(path).forEach(function (file, index) {
                    var curPath = path + "/" + file;
                    if (fs.lstatSync(curPath).isDirectory()) { // recurse
                        imapMailExtractor.deleteFolderRecursive(curPath,true);
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
    imapMailExtractor.getFolderMessages(options.user, options.password, "Dossiers partagés/ecritheque", function (err, result) {

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


    imapMailExtractor.getFolderMessages(options.user, options.password, "Dossiers partagés/archives.cjw/02-Versements/2018", function (err, result) {

    })
}
if(false){
    imapMailExtractor.toPDF_1_5_Folder("D:\\mailspdf1.3")
}
