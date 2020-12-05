
var request=require("request");
var elasticIndexer={


    indexJsonArray:function(mails, index, callback){


        var str=""
        mails.forEach(function (mail, pageIndex) {
            var elasticId=Math.round(Math.random()*100000000);

            var id = ""+elasticId

mail.content=mail.Subject+";"+mail.From+";"+mail.To+";"+mail.Cc+";"+mail.text+";"
            str+=JSON.stringify({index:{"_index": index, _type: index, "_id": id}})+"\r\n"
            str+=JSON.stringify(mail)+"\r\n"


        })

        var options = {
            method: 'POST',
            body: str,
            encoding: null,
            headers: {
                'content-type': 'application/json'
            },

            url: "http://localhost:9200/_bulk"
        };

        request(options, function (error, response, body) {

            if (error)
                return callback(err);

            var result=new String(body)
            if(result.errors)
                return callback(errors)
            return callback();
        })
    }






}








module.exports=elasticIndexer;
