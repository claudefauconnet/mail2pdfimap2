var Imap = require('imap');
var inspect = require('util').inspect;
var async = require('async');
var fs = require('fs');
var path = require('path');
var mailPdfGenerator = require('./mailPdfGenerator');
var mailPdfGeneratorHtml = require('./mailPdfGeneratorHtml');


var common = require('./common.js')
var zipdir = require('zip-dir');
var socket = require('../routes/socket.js');
var chardet = require('chardet');
var iconv = require('iconv-lite');

var libmime = require('libmime');
var base64 = require('base64-stream')


process.setMaxListeners(0);


var imapMailExtractor = {
    deleteDirAfterZip: true,
    archivePrefix: "pdfMailArchive",
    archiveMaxSize: 1000 * 1000 * 1000,//1000MO,
    maxMessageSize: 1000 * 1000 * 5,
    maxAttachmentsSize: 1000 * 1000 * 5,
    pdfArchiveDir: "./pdfs",
    host: 'imap.atd-quartmonde.org',
    port: 993,
    skippedFolders: ["Autres utilisateurs", "Dossiers partagés"],
    attachmentsExcluded: ["logosignature.png", "atd_slogan.png"],

    /*var host = 'imap.sfr.fr';
var port = 993;*/


    getImapConn: function (mailAdress, password) {
        var imap = new Imap({
            user: mailAdress,
            password: password,
            host: imapMailExtractor.host,
            port: imapMailExtractor.port,
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
        if (encoding.length > 0 && encoding != 'UTF-8') {
            try {
                var str = iconv.decode(chunk, encoding);
            }
            catch (e) {
                //   socket.message(e);
                //   console.log(e);
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


    getPartsInfos: function (parts, _infos) {
        var infos = _infos || [];
        infos.totalSize = infos.totalSize || 0;
        infos.validAttachmentsSize = infos.validAttachmentsSize || 0;
        infos.validAttachments = infos.validAttachments || {};
        infos.rejectedAttachments = infos.rejectedAttachments || {};
        infos.rejectedAttachmentsSize = infos.rejectedAttachmentsSize || 0;
        infos.textPartIds = infos.textPartIds || [];
        infos.htmlPartIds = infos.htmlPartIds || [];
        infos.partsSubTypes = infos.partsSubTypes || [];

        for (var i = 0; i < parts.length; ++i) {
            if (Array.isArray(parts[i])) {
                infos = imapMailExtractor.getPartsInfos(parts[i], infos);
            }
            else {
                if (parts[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(parts[i].disposition.type) > -1) {
                    parts[i].type = "attachment";
                    if (parts[i].size) {
                        if (parts[i].size <= imapMailExtractor.maxAttachmentsSize) {
                            infos.validAttachments[parts[i].partID] = parts[i];
                            infos.validAttachmentsSize += parts[i].size;
                        }
                        else {
                            infos.rejectedAttachments[parts[i].partID] = parts[i];
                            infos.rejectedAttachmentsSize += parts[i].size;
                        }
                    }


                } else {
                    if (parts[i].size)
                        infos.totalSize += parts[i].size;
                    if (parts[i].partID) {
                        if (parts[i].subtype) {
                            var partSubType = parts[i].subtype.toUpperCase();
                            if (infos.partsSubTypes.indexOf(partSubType) < 0)
                                infos.partsSubTypes.push(partSubType);
                            if (partSubType == "HTML")
                                infos.htmlPartIds.push(parts[i].partID);
                            else if (partSubType == "PLAIN") {
                                infos.textPartIds.push(parts[i].partID);
                            }
                            else {
                                console.log("partSubType" + partSubType)
                                var xx = "aa";
                            }
                        }
                        else {
                            var xx = "aa";
                        }
                    }
                }
                infos.push(parts[i]);
            }

        }
        return infos;


    },
    parseMessageHeader: function (headersStr) {
        //processing header metadata
        var obj = {}
        headersStr = headersStr.replace(/\r/g, "");

        var lines = headersStr.split("\n")
        var multiLineStr = "";
        var toRemove = []
        for (var i = (lines.length - 1); i > 0; i--) {
            var p = lines[i].indexOf(":");
            if (p < 0) {
                lines[i - 1] += lines[i];

            }
        }
        for (var i = 0; i < lines.length; i++) {
            var p = lines[i].indexOf(":");
            if (p > -1) {
                var key = lines[i].substring(0, p);
                var value = lines[i].substring(p + 1);
                obj[key] = value;
            }
        }
        return obj;
    }

    ,
    getFolderMailsInfos: function (mailAdress, password, folder, callback1) {

        var messages = {
            _globalInfo: {
                totalSize: 0,
                mailsCount: 0,
                validMailsCount: 0,
                attachmentsSize: 0
            }
        };
        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        imap.once('ready', function () {
            imap.openBox(folder, true, function (err, box) {
                if (err) {
                    console.log(err);
                    return callback1(err)
                }
                var headerFields = 'HEADER.FIELDS (TO FROM SUBJECT DATE SENDER CC REPLY-TO)'
                //   All functions below have sequence number-based counterparts that can be accessed by using the 'seq' namespace of the imap connection's instance (e.g. conn.seq.search() returns sequence number(s) instead of UIDs, conn.seq.fetch() fetches by sequence number(s) instead of UIDs, etc):
                imap.seq.search([['LARGER', 1]], function (err, results) {
                    // imap.search([['LARGER', 1]], function (err, results) {
                    if (results.length == 0)
                        return callback1(null, messages);
                    var f = imap.seq.fetch(results, {
                        bodies: headerFields,
                        //  bodies: ['HEADER.FIELDS (SUBJECT)', 'TEXT'],
                        struct: true
                    });

                    f.on('message', function (msg, seqno) {
                        messages[seqno] = {};
                        var buffer = '';
                        //  message.seqno = seqno;
                        var subject = "";
                        msg.on('body', function (stream, info) {
                            if (info.which == headerFields) {
                                //  if (info.which == 'HEADER.FIELDS (SUBJECT)') {
                                stream.on('data', function (chunk) {
                                        buffer += imapMailExtractor.decodeChunk(chunk);
                                    }
                                );


                                stream.once('end', function () {


                                });
                            }
                        });
                        msg.once('attributes', function (attrs) {
                            messages[seqno].infos = imapMailExtractor.getPartsInfos(attrs.struct);


                            var totalSize = messages[seqno].infos.totalSize;
                            var attachmentsSize = messages[seqno].infos.validAttachmentsSize;
                            messages._globalInfo.totalSize += totalSize;
                            if (totalSize <= imapMailExtractor.maxMessageSize)
                                messages._globalInfo.validMailsCount += 1;
                            messages._globalInfo.mailsCount += 1;
                            messages._globalInfo.attachmentsSize += attachmentsSize;


                        });
                        msg.once('end', function () {
                            var headerObj = imapMailExtractor.parseMessageHeader(buffer);
                            messages[seqno].headers = headerObj; //imapMailExtractor.getPartsInfos(attrs.struct);

                            if (messages[seqno].infos.rejectedAttachmentsSize > 0) {
                                var rejectedAttachments = messages[seqno].infos.rejectedAttachments;
                                var header = messages[seqno].headers;
                                for (var key in  rejectedAttachments)
                                    var attachmentName = imapMailExtractor.getAttachmentFileName(headerObj, rejectedAttachments[key]);
                                socket.message("<span class='rejected' >Attachment rejected , too Big  : " + attachmentName + ", size " + common.roundToMO(rejectedAttachments[key].size) + "</span>");
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
            //   return callback1(err.message);
        })
        imap.connect();

    },

    processFolderPdfs: function (mailAdress, password, folder, folderInfos, pdfArchiveFolderPath, withAttachments, callback0) {

        var totalArchiveSize = folderInfos.totalArchiveSize;
        var messages = [];
        messages.folderSize = 0;
        var partsInfos = folderInfos.partsInfos;
        var i = 0;
        var imap = imapMailExtractor.getImapConn(mailAdress, password);
        imap.once('ready', function () {
            imap.openBox(folder, true, function (err, box) {
                if (err) {
                    console.log(err);
                    return callback0(err)
                }

                //  imap.search([['SMALLER', 5000]], function (err, results) {

                //   All functions below have sequence number-based counterparts that can be accessed by using the 'seq' namespace of the imap connection's instance (e.g. conn.seq.search() returns sequence number(s) instead of UIDs, conn.seq.fetch() fetches by sequence number(s) instead of UIDs, etc):
                imap.seq.search([['LARGER', 1]], function (err, results) {
                    if (results.length == 0)
                        return callback0(null, []);
                    var folderCountMessages = 0;
                    async.eachSeries(results, function (result, callbackEachMessage) {


                        var seqBodies = [];
                        var validAttachments = folderInfos[result].infos.validAttachments;


                        // on ne fetcthe que les parts ids de texte
                        // on prefere le html
                        seqBodies = folderInfos[result].infos.htmlPartIds
                        if (seqBodies.length == 0)
                            seqBodies = folderInfos[result].infos.textPartIds;
                        if (seqBodies.length == 0)
                            var xx = 1;


                        if (withAttachments) {
                            seqBodies = seqBodies.concat(Object.keys(validAttachments));

                        }

                        if (seqBodies.length == 0)
                            return callbackEachMessage();


                        folderCountMessages += 1;


                        if (Object.keys(validAttachments).length > 0) {
                            var x = "aa";
                        }

                        //FETCH each mail
                        var f = imap.seq.fetch(result, {
                            bodies: seqBodies,
                            struct: false
                        });


                        f.on('message', function (msg, seqno) {

                            var message = folderInfos[seqno].headers;
                            var xx = folderInfos[seqno];
                            var msgState = 1;
                            var isAttachement = false;


                            msg.on('body', function (stream, info) {


                                messages.folderSize += info.size;
                                totalArchiveSize += info.size;
                                if (folderCountMessages % 10 == 0) {
                                    socket.message("__" + folderCountMessages + " messages read from  folder " + common.roundToMO(messages.folderSize) + "MO, total Archive size : " + common.roundToMO(totalArchiveSize) + "MO");
                                }

                                //process Attachments
                                if (withAttachments && validAttachments[info.which]) {
                                    var y = xx;
                                    isAttachement = true;
                                    var attachmentInfos = validAttachments[info.which];
                                    var file = imapMailExtractor.getAttachmentFileName(message, attachmentInfos, pdfArchiveFolderPath);
                                    if (file && stream) {
                                        //https://stackoverflow.com/questions/25247207/how-to-read-and-save-attachments-using-node-imap/25281153
                                        var writeStream = fs.createWriteStream(file);

                                        writeStream.on('finish', function () {
                                            //  console.log(' Done writing to file ' + file)
                                        })

                                        try {
                                            if (attachmentInfos.encoding === 'BASE64')

                                                stream.pipe(base64.decode()).pipe(writeStream);
                                            else stream.pipe(writeStream)
                                        }
                                        catch (e) {
                                            console.log(e);
                                        }
                                    }


                                } else {
                                    var y = xx;
                                    isAttachement = false;
                                }

                                if (isAttachement === false) {
                                    var buffer = '';
                                    stream.on('data', function (chunk) {

                                        // !!!!!!!!!!!determination de l'encodage du buffer pour le transformer en UTF8
                                        var str = imapMailExtractor.decodeChunk(chunk);

                                        buffer += str;


                                    });

                                    stream.once('end', function () {

                                        message.text = buffer;
                                        //  console.log(message.Subject)
                                        console.log(folderCountMessages + "   " + message.Subject + " : " + JSON.stringify(folderInfos[seqno].infos.partsSubTypes));


                                        mailPdfGeneratorHtml.createMailPdf(pdfArchiveFolderPath, message, function (err, result) {
                                            if (err) {
                                                console.log(err);
                                            }
                                        })


                                    });
                                }
                            });
                            msg.once('attributes', function (attrs) {
                                message.attributes = attrs.uid;
                            });
                            msg.once('end', function () {


                            });
                        });
                        f.once('error', function (err) {
                            socket.message("<span class='rejected'> 1 mail rejected reason :" + err.message + "</span>");
                            console.log('Fetch error: ' + err.message);
                            //  callback0(err.message);
                            callbackEachMessage(err);
                        });
                        f.once('end', function () {

                            return callbackEachMessage();

                        });
                    }, function (err) {// end eachMessage
                        if (err)
                            callback0(err)

                        return callback0(null, messages)
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


    generateFolderHierarchyMessages: function (mailAdress, password, rootFolder, withAttachments, scanOnly, callback) {
        var archivePath = null;
        var leafFolder = rootFolder;
        var archiveAttachmentsSize = 0;
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
        var pdfArchiveRootPath = imapMailExtractor.pdfArchiveDir + "/" + imapMailExtractor.archivePrefix + "_" + mailAdress + "_" + Math.round(Math.random() * 100000);
        pdfArchiveRootPath = path.resolve(pdfArchiveRootPath);
        if (!fs.existsSync(pdfArchiveRootPath)) {
            fs.mkdirSync(pdfArchiveRootPath);
        }


        imapMailExtractor.getFolderHierarchy(mailAdress, password, rootFolder, function (err, folders) {
            var output = [];


            async.eachSeries(folders, function (folder, callbackEachFolder) {
                // on ne traite pas les boites partagées (fausses racinbes qui font planter)
                if (imapMailExtractor.skippedFolders.indexOf(folder.text) > -1) {
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

                var folderInfos = [];
                var validMessages = [];

                async.series([

                    function (callbackSerie) {//getting headers and metadata
                        imapMailExtractor.getFolderMailsInfos(mailAdress, password, box, function (err, messages) {
                            if (err) {
                                return callbackSerie(err);
                            }


                            archiveAttachmentsSize += messages._globalInfo.attachmentsSize;
                            archiveTotalSize += messages._globalInfo.totalSize;
                            archiveTotalValidMails += messages._globalInfo.validMailsCount;


                            if (true || scanOnly) {
                                var text = "<hr><B>" + folder.text +
                                    " count :" + messages._globalInfo.validMailsCount + " / " + (messages._globalInfo.mailsCount) +
                                    " size :" + common.roundToMO(messages._globalInfo.totalSize) + " / " + common.roundToMO(messages._globalInfo.attachmentsSize) + " MO.of attachments";

                                socket.message(text);
                            }


                            if (archiveAttachmentsSize > imapMailExtractor.archiveMaxSize) {
                                var text = "Operation aborted : maximum size of archive reached :" + Math.round(archiveAttachmentsSize / 1000000) + "/" + Math.round(imapMailExtractor.archiveMaxSize / 1000000) + "MO"
                                socket.message(text);
                                imapMailExtractor.deleteFolderRecursive(pdfArchiveRootPath);
                                return callbackSerie2(text);


                            }

                            folderInfos = messages;
                            return callbackSerie(null, folderInfos);
                        })
                    },


                    function (callbackSerie2) {//extraction des mails bruts


                        if (scanOnly) {

                            return callbackSerie2(null);

                        }

                        // create archive pdf dir;
                        var start = folder.ancestors.indexOf(leafFolder)
                        if (start < 0)
                            return callbackSerie2(null);

                        var pdfArchiveFolderPath = pdfArchiveRootPath;
                        for (var i = start; i < folder.ancestors.length; i++) {
                            pdfArchiveFolderPath += "/" + folder.ancestors[i];
                            var dir = path.resolve(pdfArchiveFolderPath)
                            if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir);
                            }

                        }
                        console.log(pdfArchiveFolderPath);
                        folderInfos.totalArchiveSize = archiveTotalSize;
                        imapMailExtractor.processFolderPdfs(mailAdress, password, box, folderInfos, pdfArchiveFolderPath, withAttachments, function (err, messages) {

                            if (err) {
                                return callbackSerie2(err);
                            }
                            validMessages = messages;

                            return callbackSerie2(null, folderInfos);
                        })
                    }
                ], function (err, result) {
                    if (err) {
                        return callbackEachFolder(err)
                    }

                    return callbackEachFolder();
                })//end  processFolderPdfs


            }, function (err) {// endEachFolder
                var totalDuration = Math.round((new Date() - startTime) / 1000);
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                var text = "";
                if (scanOnly)
                    text = "Archive scan  result :";

                text += "<br>Total mails  :" + (archiveTotalValidMails + archiveTotalRejectedMails) +
                    // "<br>Total valid mails  :" + archiveTotalValidMails +
                    // "<br>Total rejected mails  :" + archiveTotalRejectedMails +
                    "<br>Total archive size  :" + common.roundToMO(archiveTotalSize) + "MO" +
                    "<br>Total attachments size  :" + common.roundToMO(archiveAttachmentsSize) + "MO"
                if (scanOnly) {
                    return callback(null, {

                        text: text

                    })
                }
                console.log(pdfArchiveRootPath)
                socket.message("creating  zip archive on server...");
                setTimeout(function () {
                zipdir(pdfArchiveRootPath, function (err, buffer) {
                    if (err)
                        return callback(err);
                    fs.writeFileSync(pdfArchiveRootPath + ".zip", buffer);

                    if (imapMailExtractor.deleteDirAfterZip)
                        setTimeout(function () {
                            imapMailExtractor.deleteFolderRecursive(pdfArchiveRootPath);
                        }, 1000 * 60 * 10)
                    return callback(null, {

                        text: "Total mails Processed : " + archiveTotalValidMails + "in " + totalDuration + "sec, preparing zip download, size:" + common.roundToMO(archiveAttachmentsSize) + "MO" + "<br>" + text,
                        pdfArchiveRootPath: pdfArchiveRootPath + ".zip"
                    })
                })
                }, 1000 * 5)
            })


        })

    }
    ,
    downloadArchive: function (mailAdress, pdfArchiveRootPath, response) {

        var dir = path.resolve(pdfArchiveRootPath);

        socket.message("start download zip file...");

        var archive = fs.readFileSync(dir);
        response.setHeader('Content-type', 'application/zip');
        response.setHeader("Content-Disposition", "attachment;filename=" + imapMailExtractor.archivePrefix + "-" + mailAdress + ".zip");
        response.send(archive);
        socket.message("download pdfMailArchive-" + imapMailExtractor.archivePrefix + "-" + mailAdress + " DONE");
        if (imapMailExtractor.deleteDirAfterZip)
            setTimeout(function () {
               fs.unlink(dir)
            }, 1000 * 60 * 20)

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

    /**
     *
     *
     * @param messageInfos
     * @param attachmentInfos
     * @param pdfArchiveFolderPath if not null creates the attachment folder and return path  otherwise return attachment filename only
     * @returns {*}
     */
    , getAttachmentFileName: function (messageInfos, attachmentInfos, pdfArchiveFolderPath) {
        var attachmentsDir = "";
        if (pdfArchiveFolderPath) {
            attachmentsDir = path.resolve(pdfArchiveFolderPath + "/attachments");
            if (!fs.existsSync(attachmentsDir)) {
                fs.mkdirSync(attachmentsDir);
            }
        }
        var pdfName;
        if (messageInfos.Subject)
            pdfName = messageInfos.Subject;
        else
            pdfName = "mail_sans_sujet_" + Math.round(Math.random() * 1000000);
        pdfName = mailPdfGeneratorHtml.formatStringForArchive(pdfName, mailPdfGenerator.maxPdfSubjectLength);

        var attachmentName;
        if (!attachmentInfos.params)
            if (!attachmentInfos.disposition)
                return null;
        if (attachmentInfos.disposition.params && attachmentInfos.disposition.params.name)
            attachmentName = attachmentInfos.disposition.params.name;
        if (!attachmentName && attachmentInfos.disposition.params && attachmentInfos.disposition.params.filename)
            attachmentName = attachmentInfos.disposition.params.filename;
        if (!attachmentName)
            return null;
        //   attachmentName = "attachment_" + Math.round(Math.random() * 100);
        attachmentName = imapMailExtractor.decodeChunk(attachmentName);
        if (imapMailExtractor.attachmentsExcluded.indexOf(attachmentName) > -1)
            return;
        if (attachmentName.indexOf(".eml") > -1) {
            var xx = 1;
        }

        attachmentName = mailPdfGeneratorHtml.formatStringForArchive(attachmentName, 300);

        var fileName = pdfName + "__" + attachmentName;
        if (pdfArchiveFolderPath) {


            return path.resolve(attachmentsDir + "/" + fileName);
        }
        else
            return fileName;


    }
}


module.exports = imapMailExtractor;

var options = {
    user: "claude.fauconnet@atd-quartmonde.org",
    password: "fc6kDgD8"

}
if (false) {
    //   imapMailExtractor.processFolderPdfs(options.user, options.password, "Autres utilisateurs/administration.cijw", function (err, result) {
    imapMailExtractor.processFolderPdfs(options.user, options.password, "Dossiers partagés/ecritheque", [], function (err, result) {

    })


}
if (false) {
    pdfArchiveDir = "D:\\GitHub\\mail2pdfImap\\pdfs\\"
    imapMailExtractor.generateFolderHierarchyMessages(options.user, options.password, "Autres utilisateurs/administration.cijw/Administration Montreuil", false, false, function (err, result) {
        if (err)
            console.log(err);
        console.log(result.message)
    })


}

if (false) {

    pdfArchiveDir = "D:\\GitHub\\mail2pdfImap\\pdfs\\"
    imapMailExtractor.generateFolderHierarchyMessages(options.user, options.password, "testMail2Pdf/pb", null, false, function (err, result) {

    })
}
if (false) {
    imapMailExtractor.toPDF_1_5_Folder("D:\\mailspdf1.3")
}
