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
var htmlencode = require('htmlencode');

var exec = require('child_process').exec;

var addMetaData = false;
var exec = require('child_process').exec;
var initLinuxwkhtml2pdf=false;




var mailPdfGenerator = {
    pdfDir: "",//"pdfArchives",
    maxPdfSubjectLength: 33,
    addMetaData: true
    ,

    createMailPdf: function (pdfDirPath, mail, callback) {

        var mailTitle;
        if (mail.Subject)
            mailTitle = mail.Subject;
        else
            mailTitle = "mail_sans_sujet_" + Math.round(Math.random() * 1000000);

        if(mail.Subject.indexOf("De-Diana-Skelton-archive")>-1)
            var xx="1";


        var initialName = mailTitle;
        var pdfFileName = mailTitle;

        mailTitle = mailPdfGenerator.formatStringForArchive(mailTitle, mailPdfGenerator.maxPdfSubjectLength);
        mailTitle = mailPdfGenerator.removeMultipleReAndFwdInTitle(mailTitle);
        pdfFileName = common.dateToString(new Date(mail.Date)) + "-" + mailTitle + ".pdf";


        var pdfPath = path.resolve(pdfDirPath + "/" + pdfFileName);

        //  console.log("--processing--"+pdfPath);
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
        fs.writeFileSync(pdfPath,"");


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

        }


        /*  if (true || mail.Subject.indexOf("500") > -1)
              console.log(mail.text)
          else
              return;*/

        var pdfData = "<span class=key>archive courriel</span><br><br><br>"

        pdfData += "Subject : <span class=key>" + mail.Subject + "</span><br>"
        pdfData += "From : <span class=key>" + htmlencode.htmlEncode(mail.From) + "</span><br>"
        pdfData += "To : <span class=key>" +  htmlencode.htmlEncode(mail.To) + "</span><br>"
        pdfData += "Date : <span class=key>" + mail.Date + "</span><br>";
        if (mail.Cc)
            pdfData += "Cc : <span class=key>" +  htmlencode.htmlEncode(mail.Cc) + "</span><br>";
        if (mail.ReplyTo)
            pdfData += "ReplyTo : <span class=key>" +  htmlencode.htmlEncode(mail.ReplyTo) + "</span><br>";


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

//https://github.com/wkhtmltopdf/wkhtmltopdf/issues/2000


        headContent += "<style>body{font-size :18px}.key {font-size :24px;font-weight:bold}</style>";

        var p = pdfHtml.indexOf("<head>")
        if (p < 0) {
            var q = pdfHtml.indexOf("<html>");

            pdfHtml = pdfHtml.substring(0, q + 6) + "<head>" + headContent + "</head>" + pdfHtml.substring(q + 6);
        }

        else {
            pdfHtml = pdfHtml.substring(0, q + 6) + headContent + pdfHtml.substring(q + 6);
        }
/* INSTALL LINUX wkhtmltopdf
https://discuss.flectrahq.com/t/any-guide-for-wkhtmltox-0-12-1-install-on-debian-9-x/120/4

dpkg -i libssl1.0.0_1.0.1t-1+deb8u7_amd64.deb
dpkg -i libpng12-0_1.2.49-1+deb7u2_amd64.deb

download wkhtmltopdf 0.12.2.1 jessie precompiled binary for jessie

https://github.com/wkhtmltopdf/wkhtmltopdf/releases/download/0.12.2.1/wkhtmltox-0.12.2.1_linux-jessie-amd64.deb 50

install it:
dpkg -i wkhtmltox-0.12.2.1_linux-jessie-amd64.deb

add symlink:

sudo ln -s /usr/local/bin/wkhtmltopdf /usr/bin
sudo ln -s /usr/local/bin/wkhtmltoimage /usr/bin




 */

        try {
            if(true) {
                wkhtmltopdf(pdfHtml, {
                    //  output: pdfPath,
                    noImages: true,
                    disableExternalLinks: true,
                    title: mail.Subject,
                    noBackground: true,
                    encoding: "8859-1"
                }, function (err, stream) {
                    if (err)
                        return console.log(err + "  html " + pdfHtml);
                    stream.pipe(fs.createWriteStream(pdfPath));
                });
            }
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
        catch(e){
            console.log(e);
        }
    }





    ,
    formatStringForArchive: function (str, maxLength) {
        str=str.trim();
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


