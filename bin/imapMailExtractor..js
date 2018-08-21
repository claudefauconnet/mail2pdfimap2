var Imap = require('imap');
var inspect = require('util').inspect;
var async = require('async');
var fs = require('fs');
var path = require('path');
var mailPdfGeneratorHtml = require('./mailPdfGeneratorHtml');


var common = require('./common.js')
var zipdir = require('zip-dir');
var socket = require('../routes/socket.js');
var chardet = require('chardet');
var iconv = require('iconv-lite');

var libmime = require('libmime');
var base64 = require('base64-stream');

var  AllHtmlEntities = require('html-entities').AllHtmlEntities;
var htmlEntities = new AllHtmlEntities();


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
        var folderAncestors = null;
        if (rootFolder) {
            folderAncestors = rootFolder.split("/");
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
                            if (folderAncestors && folderAncestors.indexOf(key) < 0)
                                return;
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

    decodeChunk: function (chunk, partEncoding) {
        //  var nodeEncodings=["BASE64","ASCII","UTF-8",]
        function decodeQuotedPrintable(str) {
            str = (str || '').toString().// remove invalid whitespace from the end of lines
            replace(/[\t ]+$/gm, '').// remove soft line breaks
            replace(/\=(?:\r?\n|$)/g, '');

            var encodedBytesCount = (str.match(/\=[\da-fA-F]{2}/g) || []).length,
                bufferLength = str.length - encodedBytesCount * 2,
                chr, hex,
                buffer = new Buffer(bufferLength),
                bufferPos = 0;

            for (var i = 0, len = str.length; i < len; i++) {
                chr = str.charAt(i);
                if (chr === '=' && (hex = str.substr(i + 1, 2)) && /[\da-fA-F]{2}/.test(hex)) {
                    buffer[bufferPos++] = parseInt(hex, 16);
                    i += 2;
                    continue;
                }
                buffer[bufferPos++] = chr.charCodeAt(0);
            }
            var str2=buffer.toString();
            str2= htmlEntities.decode(str2);
            return str2;
        }
        var str = "";

        var encoding = chardet.detect(chunk);

        if (partEncoding == "QUOTED-PRINTABLE") {
          str=  decodeQuotedPrintable(chunk.toString());
          return str;

        }
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
        infos.validTextsOrHtmls = infos.validTextsOrHtmls || {};

        for (var i = 0; i < parts.length; ++i) {
            if (Array.isArray(parts[i])) {
                infos = imapMailExtractor.getPartsInfos(parts[i], infos);
            }
            else {
                if (parts[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(parts[i].disposition.type) > -1) {
                    var partSubType = parts[i].subtype.toUpperCase();
                    if (partSubType == "HTML")
                        infos.htmlPartIds.push(parts[i].partID);
                    else if (partSubType == "PLAIN") {
                        infos.textPartIds.push(parts[i].partID);
                    } else {
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
                    }


                } else {
                    if (parts[i].size)
                        infos.totalSize += parts[i].size;
                    if (parts[i].partID) {
                        if (parts[i].subtype) {
                            var partSubType = parts[i].subtype.toUpperCase();
                            infos.validTextsOrHtmls[parts[i].partID] = {encoding: parts[i].encoding}
                            if (partSubType == "HTML")
                                infos.htmlPartIds.push(parts[i].partID);
                            else if (partSubType == "PLAIN") {
                                infos.textPartIds.push(parts[i].partID);
                            }
                            else {

                            }
                        }
                        else {

                        }
                    }
                }
                infos.push(parts[i]);
            }

        }
        return infos;


    }
    ,
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
                var folderCountMessages = 0;
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

                            if (folderCountMessages > 135) {
                                var xx = "a";
                            }
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
                            folderCountMessages += 1;
                            // console.log("-\t" + folderCountMessages + " \t" + headerObj.Subject);
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

    }
    ,

    processFolderPdfs: function (mailAdress, password, folder, folderInfos, pdfArchiveFolderPath, withAttachments, startTime, callback0) {

        var totalArchiveSize = folderInfos.totalArchiveSize;
        var totalArchiveCountMails = folderInfos.totalArchiveCountMails;
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
                    async.eachSeries(results, function (messageSeqno, callbackEachMessage) {


                        var seqBodies = [];
                        var validAttachments = folderInfos[messageSeqno].infos.validAttachments;


                        // on ne fetcthe que les parts ids de texte
                        // on prefere le html
                        seqBodies = folderInfos[messageSeqno].infos.htmlPartIds
                        if (seqBodies.length == 0)
                            seqBodies = folderInfos[messageSeqno].infos.textPartIds;
                        if (seqBodies.length == 0) {
                            console.log("no body in message " + messageSeqno);
                            return callbackEachMessage();
                        }
                        var messageTextOrHtmlPartsCount = seqBodies.length;
                        var messageTextOrHtmlPartsIndex = 0;
                        var messageTextOrHtmlContent = "";
                        if (withAttachments) {
                            seqBodies = seqBodies.concat(Object.keys(validAttachments));

                        }

                        if (seqBodies.length == 0)
                            return callbackEachMessage();


                        folderCountMessages += 1;


                        //*****************************FETCH each mail one after other : when pdf is writen *************************
                        //***********************************************************************

                        var message = folderInfos[messageSeqno].headers;
                        message.text = "";

                        var f = imap.seq.fetch(messageSeqno, {
                            bodies: seqBodies,
                            struct: false
                        });


                        f.on('message', function (msg, seqno) {
                            var isAttachement = false;


                            msg.on('body', function (stream, info) {
                                if (folderInfos[messageSeqno].infos.validTextsOrHtmls[info.which])
                                    var encoding = folderInfos[messageSeqno].infos.validTextsOrHtmls[info.which].encoding;

                                messages.folderSize += info.size;
                                totalArchiveSize += info.size;
                                if (folderCountMessages % 10 == 0) {
                                    var totalDuration = Math.round((new Date() - startTime) / 1000);
                                    socket.message("__" + folderCountMessages + " messages read from  folder " + folder + " " + common.roundToMO(messages.folderSize) + "MO.<br> Total archive : count " + totalArchiveCountMails + ", size  " + common.roundToMO(totalArchiveSize) + "MO in " + totalDuration + " sec.");
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

                                    isAttachement = false;
                                }

                                if (isAttachement === false) {

                                    var buffer = '';
                                    stream.on('data', function (chunk) {
                                        // !!!!!!!!!!!determination de l'encodage du buffer pour le transformer en UTF8
                                        var str = imapMailExtractor.decodeChunk(chunk, encoding);
                                        buffer += str;
                                    });
                                    stream.once('end', function () {
                                        messageTextOrHtmlPartsIndex += 1;
                                        // case where several html or text parts in same email concat parts
                                        messageTextOrHtmlContent += buffer;


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
                            message.text += messageTextOrHtmlContent;
                            mailPdfGeneratorHtml.createMailPdf(pdfArchiveFolderPath, message, function (err, result) {

                                if (err) {
                                    socket.message("<span class='rejected'>error while generating PDF  : " + err + "</span>");
                                }
                                totalArchiveCountMails += 1;
                                return callbackEachMessage();
                            })


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

    }
    ,


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
                        //  console.log(pdfArchiveFolderPath);
                        folderInfos.totalArchiveSize = archiveTotalSize;
                        folderInfos.totalArchiveCountMails = archiveTotalValidMails;
                        imapMailExtractor.processFolderPdfs(mailAdress, password, box, folderInfos, pdfArchiveFolderPath, withAttachments, startTime, function (err, messages) {

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


                //  console.log(pdfArchiveRootPath)
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

                            text: "Total mails Processed : " + archiveTotalValidMails + " in " + totalDuration + "sec, preparing zip download, size:" + common.roundToMO(archiveAttachmentsSize) + "MO" + "<br>" + text,
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
                fs.unlinkSync(dir)
            }, 1000 * 60 * 20)

    }
    ,

    downloadJournal: function (content, response) {
        var fileName = path.resolve(__dirname + "/journal.pdf")
        mailPdfGeneratorHtml.makeWkhtmlPdf(fileName, "journal", "Archive journal", content, function (err, result) {
            var archive = fs.readFileSync(fileName);
            response.setHeader('Content-type', 'application/zip');
            response.setHeader("Content-Disposition", "attachment;filename=archiveJournal.pdf");
            response.send(archive);

            return;
            var buffer = new Buffer(256);
            var chunks = [];
            stream.on('data', function (chunk) {
                chunks.push(chunk)


            });
            stream.once('end', function () {
                var buffer = new Buffer.concat(chunks).toString();
                //    response.setHeader('Content-type', 'application/pdf');
                response.setHeader("Content-Disposition", "attachment;filename=ArchiveJournal.pdf");
                response.send(buffer);


            });
            /*  var toString = require('stream-to-string');

              toString(stream, function (err, pdf) {
                  var jsfile = new Buffer.concat(chunks).toString('base64');

                  response.setHeader('Content-type', 'application/pdf');
                  response.setHeader("Content-Disposition", "attachment;filename=ArchiveJournal.pdf");
                  response.send(pdf);
              })*/


        })
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
    ,
    getAttachmentFileName: function (messageInfos, attachmentInfos, pdfArchiveFolderPath) {
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
if (false) {


    function decodeQuotedPrintable(str) {
        str = (str || '').toString().// remove invalid whitespace from the end of lines
        replace(/[\t ]+$/gm, '').// remove soft line breaks
        replace(/\=(?:\r?\n|$)/g, '');

        var encodedBytesCount = (str.match(/\=[\da-fA-F]{2}/g) || []).length,
            bufferLength = str.length - encodedBytesCount * 2,
            chr, hex,
            buffer = new Buffer(bufferLength),
            bufferPos = 0;

        for (var i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            if (chr === '=' && (hex = str.substr(i + 1, 2)) && /[\da-fA-F]{2}/.test(hex)) {
                buffer[bufferPos++] = parseInt(hex, 16);
                i += 2;
                continue;
            }
            buffer[bufferPos++] = chr.charCodeAt(0);
        }

        var str2=buffer.toString();
       str2= htmlEntities.decode(str2);
       return str2;
    }

    var str = "Lors de la derni=C3=A8re r=C3=\r\n=A9union du Comit=C3=A9 d&#39;Orientation, nous =C3=A9tions convenus que je=\r\n passerais en revue la convention avec le CNC, pour d=C3=A9cision et mise e=\r\nn =C5=93uvre =C3=A9ventuelle.</div><div><br></div><div>Si cela est toujours=\r\n d&#39;actualit=C3=A9, peux-tu m&#39;en envoyer une copie";


    var str2 = decodeQuotedPrintable(str);

    var vv = str2;

}


module.exports = imapMailExtractor;

