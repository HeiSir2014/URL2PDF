const os = require('os');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const crypto = require('crypto');
const {
    app,
    BrowserWindow,
    Tray,
    ipcMain,
    shell,
    Menu,
    dialog,
    session,
    webContents
} = require('electron');
const isDev = require('electron-is-dev');
const package_self = require('./package.json');
const express = require('express');
const asyncHandler = require('express-async-handler')
const bodyParser = require('body-parser');
const morgan  = require('morgan');
let appSvr = express();
let httpServer;
let timeouts = {};
let dbHandle = {};
let queueTasks = [];
let mainWindow;
let pdfCount = 0;

(function () {

    // 单例应用程序
    if (!app.requestSingleInstanceLock()) {
        app.quit()
        return
    }

    process.on('uncaughtException', (err, origin) => {
        logger.error(`uncaughtException: ${err} | ${origin}`)
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger.error(`unhandledRejection: ${promise} | ${reason}`)
    });

    app.on('ready', async () => {
        localConfig = path.join(app.getPath('userData'), 'config.json');

        logger = winston.createLogger({
            level: 'debug',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}` + (info.splat !== undefined ? `${info.splat}` : " "))
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({
                    filename: path.join(app.getPath('userData'), 'logs/error.log'),
                    level: 'error'
                }),
                new winston.transports.File({
                    filename: path.join(app.getPath('userData'), 'logs/all.log')
                }),
            ],
        });

        mainWindow = CreateDefaultWin({width:500,height:320,frame:true,resizable:true})
        mainWindow.loadFile(path.join("static","server.html"));
        mainWindow.webContents.on("dom-ready",()=>{
            if(fs.existsSync(localConfig))
            {
                const config = JSON.parse(fs.readFileSync(localConfig))
                mainWindow.webContents.send("message",{port:config.port||8080})
            }
        });
        appSvr.use(function (req, res, next) {
            req.headers['content-encoding'] && delete req.headers['content-encoding']
            req.headers['Content-Encoding'] && delete req.headers['Content-Encoding']
            next()
        })
        appSvr.use(bodyParser.urlencoded({ extended: true }));
        appSvr.use(bodyParser.json());
        appSvr.use(bodyParser.raw());
        appSvr.use(morgan({
            "format": "default",
            "stream": {
              write: function(str) { logger.debug(str); }
            }
        }));
        appSvr.use((err, req, res, next)=>{
            logger.error(err.stack)
            next(err)
        })

        function showDirInExplorer(dir)
        {
            shell.openExternal(dir).catch((reason)=>{
                logger.error(`openExternal Error:${dir} ${reason}`);
                
                let files = fs.readdirSync(dir);
                if(files && files.length > 0)
                {
                    shell.showItemInFolder(path.join(dir,files[0]));
                }
                else{
                    shell.showItemInFolder(dir);
                }
            });
        }

        mainWindow.webContents.on("ipc-message",(e,channel,data)=>{
            if(channel == 'start')
            {
                try {
                    httpServer && httpServer.close();
                } catch (_) {}
                httpServer = appSvr.listen(Number.parseInt(data.port) , function (e) {
                    logger.info(`server start success on ${data.port}`);
                    appSvr.get('/api/Url2PDF/', asyncHandler(apiHandle));
                    appSvr.post('/api/Url2PDF/', asyncHandler(apiHandle));
                    mainWindow.webContents.send("message",{status:"服务正在运行...",success:true})
                    let config = fs.existsSync(localConfig) ? JSON.parse(fs.readFileSync(localConfig)):{};
                    config['port'] = data.port;
                    fs.writeFileSync(localConfig,JSON.stringify(config));
                });
                httpServer.on('error',function(e){
                    logger.error(e)

                    e.code == 'EACCES' && mainWindow.webContents.send("message",{status:"端口被占用",fail:true});
                });
                return;
            }
            if(channel == 'stop')
            {
                httpServer && httpServer.close();
                mainWindow.webContents.send("message",{status:"服务停止运行"});
                return;
            }
            if(channel == 'openPDF')
            {
                const pdfDir = path.join( path.dirname(process.execPath),'pdfOuts');
                showDirInExplorer(pdfDir);
                return;
            }
            if(channel == 'openLog')
            {
                const logDir = path.join(app.getPath('userData'), 'logs')
                showDirInExplorer(logDir);
                return;
            }
        });

        mainWindow.on('close',function(e){
            console.log("close")
            mainWindow && e.preventDefault()
            mainWindow && mainWindow.hide()
        })
        mainWindow.on('closed',()=> mainWindow=null );


        tray = new Tray(path.join(__dirname, 'static/icon/logo.png'))
        tray.setTitle("URL2PDF 服务");
        tray.setToolTip("URL2PDF 服务");
        tray.on("double-click", () => {
            
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
        });
        const contextMenu = Menu.buildFromTemplate([
            {
                label: '显示窗口',
                type: 'normal',
                click: () => {
                    mainWindow.show();
                }
            },
            {
                type: 'separator'
            },
            {
                label: '退出URL2PDF',
                type: 'normal',
                click: () => {
                    mainWindow = null;
                    BrowserWindow.getAllWindows().forEach(win => win.close())
                    app.quit()
                }
            }
        ]);
        tray.setContextMenu(contextMenu);

        async function timeoutResp(webContentsId)
        {
            let res = dbHandle[webContentsId];  res && (delete dbHandle[webContentsId]);
            const content = webContents.fromId(webContentsId);
            const WebURL = content.getURL();
            const win = content?BrowserWindow.fromWebContents(content):null;
            if(res == null) {
                win && win.close();
                return;
            };
            try{
                const pdfDir = path.join( path.dirname(process.execPath),'pdfOuts');
                if( !fs.existsSync(pdfDir) )
                {
                    fs.mkdirSync(pdfDir)
                }
                const md5 =  crypto.createHash('md5').update(WebURL).digest('hex');
                const pdfFile = path.join(pdfDir,`${md5}.pdf`);
                if( !fs.existsSync(pdfFile) )
                {
                    const pdfData = await content.printToPDF({
                        printBackground: true,
                        marginsType: 0,
                        printSelectionOnly: false,
                        landscape: false,
                        pageSize: 'A4',
                        scaleFactor: 0
                    });
                    fs.writeFileSync(pdfFile,pdfData);
                }
                //res.set('Content-Type', 'application/pdf');
                
                if(res !== true)
                {
                    res.set('Content-Type', 'application/json; charset=UTF-8');
                    res.end( JSON.stringify({"ErrCode":0,"ErrInfo":"SUCCESS","PDFPath":pdfFile}) );
                }
                res = null;
                
                pdfCount += 1
                mainWindow && mainWindow.webContents.send("message",{log:`共计：已处理 ${pdfCount} 个请求`})
            }
            catch(error){
                console.log(error)
            }
            finally{
                res && res.status(404).send();
                win && win.close();
                
                let last = queueTasks.find((item)=> item.WebURL == WebURL);
                if(last)
                {
                    let idx = queueTasks.findIndex((item) => item == last);
                    idx >= 0 && queueTasks.splice(idx,1);
                }

                // 查询下一个任务
                let itr = queueTasks.find((item)=> item.Status == 0)
                if(!itr) return;

                itr.Status = 1;

                const win_ = CreateDefaultWin({width:1,height:1, webPreferences: { offscreen: true,nodeIntegration:false,contextIsolation:true } ,show:false});
                win_.loadURL(itr.WebURL);
                dbHandle[win_.webContents.id] = true;
            }
        }

        function webRequestReq(details, callback){
            if(!details.webContentsId || details.webContentsId  == mainWindow.webContents.id) {
                callback({cancel:false});return
            }
            const id = details.webContentsId;
            // console.log("webRequestReq")
            // console.log(details.url)
            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
            callback({cancel:false});
        };

        function webRequestRsp(details){
            if(!details.webContentsId || details.webContentsId  == mainWindow.webContents.id) {
                return
            }
            const id = details.webContentsId;
            // console.log("webRequestRsp")
            // console.log(details.url)
            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
        }
        
        function webRequestRspCompleted(details){
            if(!details.webContentsId || details.webContentsId  == mainWindow.webContents.id) {return}
            const id = details.webContentsId;
            // console.log("webRequestRspCompleted")
            // console.log(details.url)
            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
            timeouts[id] = setTimeout( timeoutResp,1500,id );
        }

        async function apiHandle(req, res) {
            let WebURL = req.query['WebURL'];
            if (!WebURL) {
                WebURL = req.body.WebURL;
                if (!WebURL) {
                    res.status(200).send('WebURL is empty');
                    return;
                }
            }

            const pdfDir = path.join( path.dirname(process.execPath),'pdfOuts');
            if( !fs.existsSync(pdfDir) )
            {
                fs.mkdirSync(pdfDir)
            }

            const md5 =  crypto.createHash('md5').update(WebURL).digest('hex');
            const pdfFile = path.join(pdfDir,`${md5}.pdf`);
            if( fs.existsSync(pdfFile) )
            {
                pdfCount += 1
                mainWindow && mainWindow.webContents.send("message",{log:`共计：已处理 ${pdfCount} 个请求`})
                res.set('Content-Type', 'application/json; charset=UTF-8');
                res.end( JSON.stringify({"ErrCode":0,"ErrInfo":"SUCCESS","PDFPath":pdfFile}) );
                return;
            }

            let it = queueTasks.find((item)=> item.WebURL == WebURL);
            if(it || Object.keys(dbHandle).length >= 10 ){

                !it && queueTasks.push({WebURL,Status:0});

                res.set('Content-Type', 'application/json; charset=UTF-8');
                res.end( JSON.stringify({"ErrCode":-1000,"ErrInfo":"FULL","PDFPath":""}) );
                return;
            }

            // console.log("---- start print " + WebURL)
            queueTasks.push({WebURL,Status:1});

            const win = CreateDefaultWin({width:1,height:1, webPreferences: { offscreen: true,nodeIntegration:false,contextIsolation:true } ,show:false});
            win.loadURL(WebURL);
            dbHandle[win.webContents.id] = true;

            res.set('Content-Type', 'application/json; charset=UTF-8');
            res.end( JSON.stringify({"ErrCode":-1000,"ErrInfo":"FULL","PDFPath":""}) );
            return;
        }

        
        session.defaultSession.webRequest.onBeforeRequest(webRequestReq);
        session.defaultSession.webRequest.onResponseStarted(webRequestRsp);
        session.defaultSession.webRequest.onCompleted(webRequestRspCompleted);

        logger.info('load success');
    });

    app.on('window-all-closed', () => {
        app.quit()
    });
})();

function getStartParam()
{
    let param = {
        port: 8080
    };
    process.argv.forEach(arg => {
        let _ = null;
        if((_ = arg.match(/^--(.*)=([^=]*)$/)) && _.length > 2)
        {
            param[ _[1] ]=_[2];
        }
    });
    return param;
}

function MergeObject(a, b) {
    let c = JSON.parse(JSON.stringify(a))
    for (const key in b) {
        if (Object.hasOwnProperty.call(b, key)) {
            c[key] = (typeof b[key] == 'object' && c[key] && typeof c[key] == 'object') ? MergeObject(c[key],b[key]) : b[key]
        }
    }
    return c;
}

function CreateDefaultWin(options) {
    let opt = {
        width: 1280,
        height: 720,
        skipTaskbar: false,
        transparent: false,
        frame: false,
        resizable: true,
        webPreferences: {
            nodeIntegration: true,
            spellcheck: false,
            webSecurity: !isDev,
            contextIsolation:false
        },
        alwaysOnTop: false,
        hasShadow: false,
    };
    if (options) {
        opt = MergeObject(opt,options)
    }
    let win = new BrowserWindow(opt);
    win.setMenu(null);
    opt['show'] != false && isDev && win.webContents.openDevTools()
    return win;
}