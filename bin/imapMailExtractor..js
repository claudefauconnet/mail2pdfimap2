var Imap = require('imap');
var inspect = require('util').inspect;
var async = require('async');
var simpleParser = require('mailparser').simpleParser;
var fs = require('fs');
var path = require('path');
var mailPdfGenerator = require('./mailPdfGenerator');
var mailPdfGeneratorHtml = require('./mailPdfGeneratorHtml');
//var archiveZipper = require('./archiveZipper');

var common = require('./common.js')
var zipdir = require('zip-dir');
var socket = require('../routes/socket.js');
var chardet = require('chardet');
var iconv = require('iconv-lite');

var libmime = require('libmime');
var archiver = require('archiver');


if (path.sep == "\\")


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


    getPartsInfos: function (parts, _infos) {
        var infos = _infos || [];
        infos.totalSize = infos.totalSize || 0;
        infos.attachementsSize = infos.attachementsSize || 0;
        infos.attachementIds = infos.attachementIds || [];
        infos.textPartIds = infos.textPartIds || [];
        infos.htmlPartIds = infos.htmlPartIds || [];

        for (var i = 0; i < parts.length; ++i) {
            if (Array.isArray(parts[i])) {
                infos = imapMailExtractor.getPartsInfos(parts[i], infos);
            }
            else {
                if (parts[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(parts[i].disposition.type) > -1) {
                    parts[i].type = "attachment";
                    infos.attachementIds.push(parts[i].id);
                    if (parts[i].size)
                        infos.attachementsSize += parts[i].size;


                }
                if (parts[i].size)
                    infos.totalSize += parts[i].size;
                if (parts[i].partID) {
                    if (parts[i].subtype && parts[i].subtype.toUpperCase() == "HTML")
                        infos.htmlPartIds.push(parts[i].partID);
                    else
                        infos.textPartIds.push(parts[i].partID);
                }
                infos.push(parts[i]);
            }

        }
        return infos;


    }
    ,
    getFolderMailsInfos: function (mailAdress, password, folder, callback1) {

        var messages = {
            _globalInfo: {
                totalSize: 0,
                mailsCount: 0
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
                                    //    console.log(buffer);
                                    messages[seqno].headers = buffer; //imapMailExtractor.getPartsInfos(attrs.struct);


                                });
                            }
                        });
                        msg.once('attributes', function (attrs) {
                            messages[seqno].infos = imapMailExtractor.getPartsInfos(attrs.struct);
                            var totalSize = messages[seqno].infos.totalSize;
                            messages._globalInfo.totalSize += totalSize;
                            messages._globalInfo.mailsCount += 1;

                        });
                        msg.once('end', function () {
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

    processFolderPdfs: function (mailAdress, password, folder, folderInfos, pdfArchiveFolderPath, callback0) {


        var zipArchive = imapMailExtractor.initZipArchive(pdfArchiveFolderPath);

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
                imap.seq.search([['SMALLER', imapMailExtractor.maxMessageSize]], function (err, results) {
                    if (results.length == 0)
                        return callback0(null, []);

                    async.eachSeries(results, function (result, callbackEachMessage) {
                        var seqBodies = []
                        // on ne fetcthe que les parts ids de texte

                        seqBodies = folderInfos[result].infos.htmlPartIds
                        if (seqBodies.length == 0)
                            seqBodies = folderInfos[result].infos.textPartIds
                        if (seqBodies.length == 0)
                            return callbackEachMessage();

                        var f = imap.seq.fetch(result, {
                            bodies: seqBodies,
                            struct: false
                        });
                        var folderCountMessages = 1;

                        f.on('message', function (msg, seqno) {

                            var message = {};
                            var msgState = 1;

                            msg.on('body', function (stream, info) {

                                if (info.which == 'HEADER') {
                                    stream.on('data', function (chunk) {
                                        var str = chunk.toString('utf8');
                                    })


                                }


                                messages.folderSize += info.size;
                                if (folderCountMessages % 10 == 0) {
                                    socket.message("__" + folderCountMessages + " messages read from  folder " + common.roundToKO(messages.folderSize) + "KO");
                                }
                                var buffer = '';
                                stream.on('data', function (chunk) {
                                        if (msgState > 0 && info.size > imapMailExtractor.maxMessageSize) {
                                            msgState = -1;
                                            socket.message("mail exceed max size for archive " + common.roundToMO(info.size));
                                            return;
                                        }
                                        // !!!!!!!!!!!determination de l'encodage du buffer pour le transformer en UTF8
                                        var str = imapMailExtractor.decodeChunk(chunk);

                                        buffer += str;

                                    }
                                );

                                stream.once('end', function () {
                                    message = {
                                        text: buffer
                                    }

                                });
                            });
                            msg.once('attributes', function (attrs) {
                                message.attributes = attrs.uid;
                            });
                            msg.once('end', function () {
                                folderCountMessages += 1;

                                //processing header metadata
                                var headersStr = folderInfos[seqno].headers;
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
                                        message[key] = value;
                                    }
                                }
                                //end processing headers metadata
                                var pdfObj = "";
                                async.series([

                                    function (callbackPdfSerie) {
                                        mailPdfGeneratorHtml.createMailPdf(pdfArchiveFolderPath, message, function (err, result) {
                                            if (err) {
                                                console.log(err);
                                                return callbackPdfSerie(err);
                                            }
                                            pdfObj = result;
                                            return callbackPdfSerie();

                                        })
                                    },
                                    function (callbackPdfSerie) {
                                        zipArchive.append(message.stream, {name: message.name});
                                        return callbackPdfSerie();
                                    }]
                                    ,
                                    function (err) {

                                })


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
                        zipArchive.finalize();
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

                var folderInfos = [];
                var validMessages = []
                async.series([

                    function (callbackSerie) {// selection des mails à exclure
                        imapMailExtractor.getFolderMailsInfos(mailAdress, password, box, function (err, messages) {
                            if (err) {
                                return callbackSerie(err);
                            }


                            archiveValidSize += messages._globalInfo.totalSize;
                            archiveTotalValidMails += messages._globalInfo.mailsCount;


                            if (true || scanOnly) {
                                var text = "<hr><B>" + folder.text +
                                    " count :" + messages.countValidMessages + "/" + (messages.length + messages.countValidMessages) +
                                    " size :" + common.roundToMO(messages.totalValidSize) + "/" + common.roundToMO(messages.totalSize) + " MO.";

                                socket.message(text);
                            }


                            if (archiveValidSize > imapMailExtractor.archiveMaxSize) {
                                var text = "Operation aborted : maximum size of archive reached :" + Math.round(archiveValidSize / 1000000) + "/" + Math.round(imapMailExtractor.archiveMaxSize / 1000000) + "MO"
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


                        for (var i = start; i < folder.ancestors.length; i++) {
                            pdfArchiveRootPath += "/" + folder.ancestors[i];
                            var dir = path.resolve(pdfArchiveRootPath)
                            if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir);
                            }

                        }


                        //    imapMailExtractor.processFolderPdfsNew(mailAdress, password, box, folderInfos, function (err, messages) {
                        imapMailExtractor.processFolderPdfs(mailAdress, password, box, folderInfos, pdfArchiveRootPath, function (err, messages) {

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
                    //  totalMails += result.length;
                    return callbackEachFolder();
                })//end  processFolderPdfs
                //  });//end getExcludedAttachmentsFolderMessages
                //  }); //end  getFolderMailsInfos


            }, function (err) {// endEachFolder
                var totalDuration = Math.round((new Date() - startTime) / 1000);
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                var text = "Archive scan  OK :" +
                    "<br>Total mails  :" + (archiveTotalValidMails + archiveTotalRejectedMails) +
                    "<br>Total valid mails  :" + archiveTotalValidMails +
                    "<br>Total rejected mails  :" + archiveTotalRejectedMails +
                    "<br>initial archive size  :" + common.roundToMO(archiveTotalSize) + "MO" +
                    "<br>valid archive size  :" + common.roundToMO(archiveValidSize) + "MO"
                if (scanOnly) {
                    return callback(null, {

                        text: text

                    })
                }
                return callback(null, {

                    text: "Total mails Processed :" + totalMails + "in " + totalDuration + "sec, preparing zip download, size:" + common.roundToMO(archiveValidSize) + "MO" + "<br>" + text,
                    pdfArchiveRootPath: pdfArchiveRootPath
                })
            })


        })

    },

    initZipArchive: function (rootFolder) {
        // create a file to stream archive data to.
        var output = fs.createWriteStream('D:\\example.zip');
        var archive = archiver('zip', {
            zlib: {level: 9} // Sets the compression level.
        });
        output.on('close', function () {
            console.log(archive.pointer() + ' total bytes');
            console.log('archiver has been finalized and the output file descriptor has closed.');
        });


        output.on('end', function () {
            console.log('Data has been drained');
        });

        archive.on('warning', function (err) {
            if (err.code === 'ENOENT') {
                // log warning
            } else {
                // throw error
                throw err;
            }
        });

        archive.on('error', function (err) {
            throw err;
        });


        archive.pipe(output);
        return archive;

    }


    ,
    downloadArchive: function (mailAdress, pdfArchiveRootPath, response) {


        var dir = path.resolve(pdfArchiveRootPath);
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
