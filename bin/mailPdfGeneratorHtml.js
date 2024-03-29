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
var path = require('path');
var common = require('./common.js');
var socket = require('../routes/socket.js');
var imapMailExtractor = require("./imapMailExtractor..js");

var wkhtmltopdf = require('wkhtmltopdf');
wkhtmltopdf.command="C:\\Program Files\\wkhtmltopdf\\bin\\wkhtmltopdf.exe"
var htmlencode = require('htmlencode');


var mailPdfGenerator = {
    pdfDir: "",//"pdfArchives",
    maxPdfSubjectLength: 33
    ,

    createMailPdf: function (pdfDirPath, mail, callback) {

        var mailTitle;
        if (mail.Subject)
            mailTitle = mail.Subject;
        else
            mailTitle = "mail_sans_sujet_" + Math.round(Math.random() * 1000000);


        var initialName = mailTitle;
        var pdfFileName = mailTitle;

        mailTitle = mailPdfGenerator.formatStringForArchive(mailTitle, mailPdfGenerator.maxPdfSubjectLength);
        mailTitle = mailPdfGenerator.removeMultipleReAndFwdInTitle(mailTitle);
        pdfFileName = common.dateToString(new Date(mail.Date)) + "-" + mailTitle + ".pdf";


        var pdfPath = path.resolve(pdfDirPath + "/" + pdfFileName);

        // Check duplicates file names and increment if exists
        if (fs.existsSync(pdfPath)) {
            var pathRoot = pdfPath.substring(0, pdfPath.indexOf(".pdf"))
            var newPath;
            var increment = 1;
            do {
                newPath = pathRoot + "-" + increment + ".pdf";
                increment += 1
            } while (fs.existsSync(newPath))
            pdfPath = newPath


        }
        fs.writeFileSync(pdfPath, "");

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
            mail.text = mail.text.replace(/<meta[^>]*>/g, "")

            //avec <pre></pre>
            if( mail.text.indexOf("<pre")>-1 || mail.text.indexOf("<PRE>")>-1) {
                mail.text = mail.text.replace(/<.?pre[^>]*>/gi, "");
                mail.text = mail.text.replace(/&lt;/gi, "");
                mail.text = mail.text.replace(/&gt;/gi,"<br>");
                mail.text = mail.text.replace(/\*/g, "");
            }
        }


        var pdfData = ""

        pdfData += "Subject : <span class=key>" + mail.Subject + "</span><br>"
        pdfData += "From : <span class=key>" + htmlencode.htmlEncode(mail.From) + "</span><br>"
        pdfData += "To : <span class=key>" + htmlencode.htmlEncode(mail.To) + "</span><br>"
        pdfData += "Date : <span class=key>" + mail.Date + "</span><br>";
        if (mail.Cc)
            pdfData += "Cc : <span class=key>" + htmlencode.htmlEncode(mail.Cc) + "</span><br>";
        if (mail.ReplyTo)
            pdfData += "ReplyTo : <span class=key>" + htmlencode.htmlEncode(mail.ReplyTo) + "</span><br>";

        if (mail.validAttachments.length > 0) {
            pdfData += "Attachments :<ul>";
            for (var i = 0; i < mail.validAttachments.length; i++) {
                pdfData += "<li>" + mail.validAttachments[i] + "</li>";
            }
            pdfData += "</ul>"
        }
        if (mail.rejectedAttachments.length > 0) {
            //  pdfData += "Rejected attachements (size>"+common.roundToMO(imapMailExtractor.maxAttachmentsSize)+"MO.:<ul>" ;
            pdfData += "<B>Rejected</B> attachements (size too large) :<ul>";
            for (var i = 0; i < mail.rejectedAttachments.length; i++) {
                pdfData += "<li>" + mail.rejectedAttachments[i] + "</li>";
            }
            pdfData += "</ul>"
        }

        var pdfHtml;
        var p = mail.text.indexOf("<html>");
        if (p < 0) {
            pdfHtml = "<html>" + pdfData + mail.text + "</html>";

        }
        else {

            var p = mail.text.indexOf("<body>");
            if (p < 0)
                p = mail.text.indexOf("</head>");
            if (p < 0)
                p = mail.text.indexOf("<html>");

            pdfHtml = mail.text.substring(0, p + 6) + pdfData + mail.text.substring(p + 6);
        }

        var headContent = "<meta charset=\"UTF-8\" />"


        headContent += "<style>body{font-size :12px}.key {font-size :12px;font-weight:bold}</style>";

        var p = pdfHtml.indexOf("<head>")
        if (p < 0) {
            var q = pdfHtml.indexOf("<html>");

            pdfHtml = pdfHtml.substring(0, q + 6) + "<head>" + headContent + "</head>" + pdfHtml.substring(q + 6);
        }

        else {
            pdfHtml = pdfHtml.substring(0, q + 6) + headContent + pdfHtml.substring(q + 6);
        }


        try {
            wkhtmltopdf(pdfHtml, {
                //  output: pdfPath,
                noImages: true,
                disableExternalLinks: true,
                title: mail.Subject,
                noBackground: true,
                encoding: "8859-1"
            }, function (err, stream) {
                if (err) {
                    console.log(err + "  html " + pdfHtml);
                    return callback(pdfFileName);
                }

                stream.pipe(fs.createWriteStream(pdfPath));
                callback(null, pdfFileName)
            });
            //   mailPdfGenerator.makeWkhtmlPdf(pdfPath,pdfFileName,mail.Subject,pdfHtml,callback);


            /*   else{//linux Debian


                   var tempHtmlPath=pdfPath.replace(".pdf",".html")

                   fs.writeFileSync(tempHtmlPath,pdfHtml)   ;

                   //  var cmd =" xvfb-run --auto-servernum --server-num= 1  /usr/local/sbin/wkhtmltopdf ";
                   var cmd ="/usr/local/sbin/wkhtmltopdf ";
                   if( path.sep=="\\") {
                       cmd = 'D:\\wkhtmltox\\bin\\wkhtmltopdf';
                   }
                   var options="";
                   cmd+=options+" "+tempHtmlPath+" "+pdfPath;
                   console.log(cmd);
                   exec(cmd, function (err, stdout, stderr) {

                       if (err) {
                           console.log(err);



                       }
                       fs.unlinkSync(tempHtmlPath);


                   });


               }*/

        }
        catch (e) {
            console.log(e);
        }
    }

    ,
    makeWkhtmlPdf: function (pdfPath, pdfFileName, title, pdfHtml, callback) {


        try {


            wkhtmltopdf(pdfHtml, {

                    /* noImages: true,
                      disableExternalLinks: true,
                      title: title,
                      noBackground: true,
                      encoding: "8859-1"*/
                }

                , function (err, stream) {
                    if (err) {
                        console.log(err + "  html " + pdfHtml);
                        return callback(pdfFileName);
                    }
                    if (pdfPath) {
                        stream.once('end', function () {
                            callback(null, pdfFileName);
                        });

                        stream.pipe(fs.createWriteStream(pdfPath));

                    }
                    else {
                        callback(null, stream);
                    }
                });

        }
        catch (e) {

            console.log(e);
        }

    }


    ,
    formatStringForArchive: function (str, maxLength) {
        str = str.trim();
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

    }


}


module.exports = mailPdfGenerator;


