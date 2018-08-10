/*******************************************************************************
 * mailArchiver_ATD LICENSE************************
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2017 Claude Fauconnet claude.fauconnet@neuf.fr
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 ******************************************************************************/

var fs = require('fs')
var modulesDir = "";//'../../../../nodeJS/node_modules/'
var PDFDocument = require(modulesDir + 'pdfkit');
var path = require('path');
var common = require('./common.js');
var socket = require('../routes/socket.js');
var wkhtmltopdf = require('wkhtmltopdf');

var addMetaData = false;


var mailPdfGenerator = {
    pdfDir: "",//"pdfArchives",
    maxPdfSubjectLength: 33,
    addMetaData: true,
    attachmentMaxSize: 5000000,
    attachmentsExcluded: ["logosignature.png", "atd_slogan.png"]
    ,

    createMailPdf: function (pdfDirPath, mail, callback) {
        try {


            var mailTitle;
            if (mail.Subject)
                mailTitle = mail.Subject;
            else
                mailTitle = "mail_sans_sujet_" + Math.round(Math.random() * 1000000);
            var initialName = mailTitle;
            var pdfFileName = mailTitle;

            mailTitle = mailPdfGenerator.formatStringForArchive(mailTitle, mailPdfGenerator.maxPdfSubjectLength);
            mailTitle = mailPdfGenerator.removeMultipleReAndFwdInTitle(mailTitle);
            pdfFileName = common.dateToString(mail.date) + "-" + mailTitle + ".pdf";


            var pdfPath = path.resolve(pdfDirPath + "/" + pdfFileName);
            // console.log("--processing--"+pdfFileName);
            if (fs.existsSync(pdfPath)) {
                var pathRoot = pdfPath.substring(0, pdfPath.indexOf(".pdf"))
                var newPath;
                var increment = 1;
                do {
                    newPath = pathRoot + "-" + increment + ".pdf";
                    increment += 1
                } while (fs.existsSync(newPath))

                pdfPath = newPath


                //    console.log(" !!!!--duplicate--"+pdfFileName);

            }


            if (mail.text.indexOf("html") < 0) {

                mail.text = mail.text.replace(/\n/g, "<br>")
                mail.text = mail.text.replace(/\r/g, "")
                mail.text = "<html><body>" + mail.text + "</body></html>"

            } else {
                mail.text = mail.text.replace(/=\n/g, "")
                mail.text = mail.text.replace(/=\r/g, "")
                mail.text = mail.text.replace(/\n/g, "")
                mail.text = mail.text.replace(/\r/g, "")
                mail.text = mail.text.replace(/\n/g, "")
           //     mail.text = mail.text.replace(/<blockquote.*<\/blockquote>/gm, "");
                mail.text = mail.text.replace(/<img.*>/gm, "");


            }
            var pdfHtmlHeader="<style>body{font-size :18px}.key {font-size :24px;font-weight:bold}</style>"
          pdfHtmlHeader+="<span class=key>Subject</span>"+mail.Subject+"<br>"
            pdfHtmlHeader+="<span class=key>From</span>"+mail.From+"<br>"
            pdfHtmlHeader+="<span class=key>To</span>"+mail.To+"<br>"
            pdfHtmlHeader+="<span class=key>Date</span>"+mail.Date+"<br>"



            var pdfHtml="";
            var p=mail.text.indexOf("<head>")
            if(p<0){
                pdfHtmlHeader="<head>"+pdfHtmlHeader+"</head>";
            }
            p=mail.text.indexOf("<html>")
            if(p<0){
                pdfHtml="<html>"+pdfHtmlHeader+mail.text+"</html>";

            }
            else{
                pdfHtml=mail.text.substring(0,p+6)+pdfHtmlHeader+mail.text.substring(p+7);

            }


console.log(pdfHtml);



            wkhtmltopdf(pdfHtml).pipe(fs.createWriteStream(pdfPath));
        }catch(e){
            console.log(e);
        }


    },
    formatStringForArchive: function (str, maxLength) {
        str = common.toAscii(common.truncate(str, maxLength));
        str = str.replace(/ /g, "_");
        str = common.replaceNonLetterOrNumberChars(str, "");
        str = str.replace(/_/g, "-");
        return str;
    },
    removeMultipleReAndFwdInTitle: function (str) {
        var re = /Re[-_:]/gi
        var fwd = /Fwd[-_:]/gi;
        var str0 = str;

        var reArray = str.match(re);
        if (reArray && reArray.length > 1) {
            //  str = "Re-" + reArray.length + "-" + str.replace(re, "");
            str = str.replace(re, "") + "-Re-" + reArray.length;
        }
        else if (reArray && reArray.length == 1) {// on met Re_ en fin
            str = str.replace(re, "") + "-Re"
        }
        var fwdArray = str0.match(fwd);
        if (fwdArray && fwdArray.length > 1) {

            str = str.replace(fwd, "") + "-Fwd-" + fwdArray.length;
        }
        else if (fwdArray && fwdArray.length == 1) {// on met Re_ en fin
            str = str.replace(fwd, "") + "-Fwd"
        }
        return str;
    }, removeHtmlTags: function (str) {
        str = str.replace(/<\/p>/gi, "\n");
        str = str.replace(/<BR>/gi, "\n");
        str = str.replace(/<[^>]*>/gi, "");

        //specific CF
        str = str.replace(/&nbsp;/gi, "");
        str = str.replace(/@import.*/gi, "");
        str = str.replace(/[™•]+.*/gm, "");

        str = str.replace(/[\r]+.*/gm, "");


        return str;
    }, processDuplicateMailTitles: function (pdfDirPath, pdfFileName) {
        var i = 0;
        var isDuplicate = false
        var prefix = ""
        do {
            isDuplicate = fs.existsSync(path.resolve(pdfDirPath + "/" + prefix + pdfFileName));
            if (isDuplicate) {
                i++;
                prefix = "" + i;
            }
            else {
                return pdfFileName.substring(0, pdfFileName.indexOf(".pdf")) + prefix + ".pdf";
            }

        } while (i < 100)
        return pdfFileName;

    },
    processAttachment: function (attachment, pdfDirPath, pdfFileName) {
        if (attachment.filename.indexOf(".asc") > -1) {// attachment of type signature ???
            return;
        }
        if (mailPdfGenerator.attachmentsExcluded.indexOf(attachment.filename) > -1)
            return;

        var attachmentsDir = path.resolve(pdfDirPath + "/attachments");
        if (!fs.existsSync(attachmentsDir)) {
            fs.mkdirSync(attachmentsDir);
        }
        var pdfPreffix = pdfFileName.substring(0, pdfFileName.lastIndexOf("."))
        /* var dir = path.resolve(attachmentsDir + "/" + pdfDir);
         if (!fs.existsSync(dir)) {
             fs.mkdirSync(dir);
         }*/
        var attachmentFileName = pdfPreffix + "__" + attachment.filename
        if (attachment.content.length > mailPdfGenerator.attachmentMaxSize) {
            socket.message("BBBBBBBBBBBBBBBBB-BigAttachment :" + (attachment.content.size / 1000000) + "MO maximum " + (mailPdfGenerator.maxPdfSubjectLength / 1000000) + "  " + pdfDirPath + "/" + pdfFileName);
            var attachmentFileName = pdfPreffix + "BIG-FILE__" + "__" + attachment.filename;
            var file = path.resolve(attachmentsDir + "/" + attachmentFileName);
            fs.writeFileSync(file, "BigAttachment content removed, size : " + attachment.content.size);
        } else {
            var file = path.resolve(attachmentsDir + "/" + attachmentFileName);
            fs.writeFileSync(file, attachment.content);
        }
        return attachmentFileName;
    }


}


module.exports = mailPdfGenerator;


