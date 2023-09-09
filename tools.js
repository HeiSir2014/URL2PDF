
const fs = require('fs');
const path=require('path');
function travel(dir,callback){
    fs.readdirSync(dir).forEach((file)=>{
        var pathname=path.join(dir,file)
        if(fs.statSync(pathname).isDirectory()){
            travel(pathname,callback)
        }else{
            callback(pathname)
        }
    })
}

let data = fs.readFileSync('all.log',{encoding:'utf-8'})

travel("D:\\files\\pdfFiles\\20211130\\",(pathname)=>{
    var name = path.basename(pathname)+" | ";
    var idx = data.indexOf(name)+name.length;
    var end = data.indexOf(' ',idx);
    console.log(idx,end)
    var url = data.substr(idx,data.indexOf(' ',idx)-idx);
    console.log(`${ path.basename(pathname).replace('.pdf','') },${pathname},${url}`)
})
