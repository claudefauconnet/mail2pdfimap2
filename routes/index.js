var express = require('express');
var router = express.Router();
var imapMailExtractor=require('../bin/imapMailExtractor..js');


/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/socket.io', function(req, res, next) {
    response.send("io/socket.io.js");
});

router.post('/imap', function (req, response) {

    //  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!" + JSON.stringify(req.body));
    if (req.body.getFolderHierarchy)
        imapMailExtractor.getFolderHierarchy(req.body.imapServer,req.body.mailAdress,req.body.password ,req.body.rootFolder,req.body.folderId,  function (error, result) {
            processResponse(response, error, result)
        });

    if (req.body. generateFolderHierarchyMessages){
        imapMailExtractor. generateFolderHierarchyMessages(req.body.imapServer,req.body.mailAdress,req.body.password ,req.body.rootFolder,req.body.folderId, req.body.withAttachments, req.body.scanOnly, function (error, result) {
           if(error) {
             return  processResponse(response, error, result)
           }
            imapMailExtractor.downloadArchive (req.body.mailAdress, result.pdfArchiveFolderPath, response)

            })


        };
    if (req.body. generateMultiFoldersHierarchyMessages){
        imapMailExtractor. generateMultiFoldersHierarchyMessages(req.body.imapServer,req.body.mailAdress,req.body.password ,req.body["rootFolders[]"],req.body["folderIds[]"], req.body.withAttachments, req.body.scanOnly, function (error, result) {
            if(error) {
                return  processResponse(response, error, result)
            }

            if( result.pdfArchiveFolderPath) {

                return  processResponse(response, error, result)
                imapMailExtractor.downloadArchive(req.body.mailAdress, result.pdfArchiveFolderPath, response)
            }else
                return  processResponse(response, error, result)

        })
        };



    if (req.body.downloadArchive)
        imapMailExtractor.downloadArchive(req.body.mailAdress,req.body.pdfArchiveRootPath, response);
    if (req.body.downloadJournal)
        imapMailExtractor.downloadJournal(req.body.content, response);



});

function processResponse(response, error, result) {
    if (response && !response.finished) {

        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // If needed
        response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,contenttype'); // If needed
        response.setHeader('Access-Control-Allow-Credentials', true); // If needed


        if (error) {
            if (typeof error == "object") {
                error = JSON.stringify(error, null, 2);
            }
            console.log("ERROR !!" + error);
          //  socket.message("ERROR !!" + error);
            response.status(404).send( error);

        }
        else if (!result) {
            response.send({done: true});
        } else {

            if (typeof result == "string") {
                resultObj = {result: result};
             //  socket.message(resultObj);
                response.send(JSON.stringify(resultObj));
            }
            else {
                if (result.contentType && result.data) {
                    try {
                        response.setHeader('Content-type', result.contentType);
                    }
                    catch(e){
                        console.log(e);
                    }
                    if (typeof result.data == "object")
                        response.send(JSON.stringify(result.data));
                    else
                        response.send(result.data);
                }
                else {
                    var resultObj = result;
                    // response.send(JSON.stringify(resultObj));
                    response.send(resultObj);
                }
            }
        }


    }


}
module.exports = router;
