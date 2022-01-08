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
const { cpuUsage } = require('process');

function getDate(){
    return new Date(Date.now() + 3600000*8).toJSON().substring(0,10)
}

let appSvr = express();
let httpServer;
let timeouts = {};
let dbHandle = {};
let queueTasks = [];
let mainWindow;
let pdfCount = 0;
let pdfCountToday = 0;
let pdfCountDate = getDate();
let tray = null;
let processStartTime = '';
let percentCPUUsage = 0;
let _cpuUsage;

(function () {

    // 单例应用程序
    if (!app.requestSingleInstanceLock()) {
        app.quit()
        return
    }
    app.commandLine.appendSwitch('no-sandbox')
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-software-rasterizer')
    app.commandLine.appendSwitch('disable-gpu-compositing')
    app.commandLine.appendSwitch('disable-gpu-rasterization')
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    app.commandLine.appendSwitch('--no-sandbox')
    app.disableHardwareAcceleration();

    process.on('uncaughtException', (err, origin) => {
        logger.error(`uncaughtException: ${err} | ${origin}`)
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger.error(`unhandledRejection: ${promise} | ${reason}`)
    });

    app.on('ready', async () => {
        localConfig = path.join(app.getPath('userData'), 'config.json');
        processStartTime = new Date(Date.now() + 3600000*8).toJSON().replace('T',' ').replace('Z','');
        _cpuUsage = process.getCPUUsage();
        _cpuUsage.percentCPUUsage;
        setInterval(()=>{
            percentCPUUsage = process.getCPUUsage().percentCPUUsage
        },1000);
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
                    level: 'error',
                    maxsize:5*1024*1024,
                    maxFiles:5
                }),
                new winston.transports.File({
                    filename: path.join(app.getPath('userData'), 'logs/all.log'),
                    maxsize:5*1024*1024,
                    maxFiles:5
                }),
            ],
        });

        mainWindow = CreateDefaultWin({width:600,height:480,frame:true,resizable:true})
        mainWindow.loadFile(path.join("static","server.html"));
        mainWindow.webContents.on("dom-ready",()=>{
            let prints = mainWindow.webContents.getPrinters();
            logger.info(JSON.stringify(prints));
            if(fs.existsSync(localConfig))
            {
                const config = JSON.parse(fs.readFileSync(localConfig))
                config.pdfCount && (pdfCount = config.pdfCount);
                config.pdfCountDate && config.pdfCountDate == getDate() && (pdfCountToday= config.pdfCountToday);
                console.log(config)
                mainWindow.webContents.send("message",{port:config.port||8080,
                    log:`共计生成<strong class="pdfCount">${
                        pdfCount
                    }</strong>| 今日<strong class="pdfCountToday">${pdfCountToday}</strong>份报告`,pdfCount,restart:config.restart||false})
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
                    appSvr.get('/api/status/', asyncHandler((req, res)=>{
                        res.setHeader("Cache-Control","no-cache, no-store, must-revalidate")
                        res.setHeader("Pragma","no-cache")
                        res.setHeader("Expires","0")
                        res.send(`<!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta http-equiv="X-UA-Compatible" content="IE=edge">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
                            <meta http-equiv="Pragma" content="no-cache" />
                            <meta http-equiv="Expires" content="0" />
                            <title>PDF 服务状态</title>
                            <style>
                                body,html{
                                    margin:0;
                                    padding:0;
                                }

                                .header,.title{
                                    width:100%;
                                    margin: 0 auto;
                                    display: block;
                                    color: #fff;
                                    padding: 10px 60px;
                                    box-sizing: border-box;
                                }

                                .pdfCount{
                                    color: #ff864d;
                                    font-size: 48px;
                                    margin: 0 10px;
                                    text-shadow: 2px 1px #9b9b9b;
                                }

                                .pdfCountToday{
                                    color: #0aa5ff;
                                    font-size: 64px;
                                    margin: 0px 15px;
                                    text-shadow: 2px 1px #c2c2c2;
                                }

                                .content{
                                    overflow: hidden;
                                    border-radius:50px;
                                    padding: 50px 0;
                                    background-color: #b282dd;
                                    margin: 100px auto 0 auto;
                                    width: 640px;
                                    max-width:100%;
                                }

                                @media screen and (max-width:640px){
                                    .header{
                                        font-size:18px;
                                        padding: 10px 20px;
                                    }
                                    .pdfCount{
                                        font-size: 24px;
                                    }
                                    .pdfCountToday{
                                        font-size: 32px;
                                    }
                                    .content{
                                        margin: 0px auto 0 auto;
                                        border-radius:10px;
                                    }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="content">
                                <h1 class="title" style="text-align:center;">报告转码服务</h1>
                                <h2 class="header">当前时间：${ new Date(Date.now() + 3600000*8).toJSON().replace('T',' ').replace('Z','') }</h2>
                                <h2 class="header">启动时间：${ processStartTime }</h2>
                                <h2 class="header">共计<strong class="pdfCount">${ pdfCount }</strong>| 今日<strong class="pdfCountToday">${ pdfCountToday }</strong>份报告</h1>
                                <h2 class="header">CPU使用率：${ Math.floor(percentCPUUsage) }%</h1>
                                <h2 class="header">内存使用率：${ Math.floor((process.getSystemMemoryInfo().total - process.getSystemMemoryInfo().free) * 100 /  process.getSystemMemoryInfo().total) }%</h1>
                            </div>
                            <script>
                                setTimeout(()=>{
                                    location.reload();
                                },5000);
                            </script>
                        </body>
                        </html>`);
                    }));
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
            if(channel == 'set-restart')
            {
                let config = fs.existsSync(localConfig) ? JSON.parse(fs.readFileSync(localConfig)):{};
                config['restart'] = data;
                fs.writeFileSync(localConfig,JSON.stringify(config));
                return;
            }
            if(channel == 'restart')
            {
                tray && tray.destroy();
                app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
                app.exit(0)
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
            },{
                label: '重启服务',
                type: 'normal',
                click: () => {
                    mainWindow = null;
                    BrowserWindow.getAllWindows().forEach(win => win.close())
                    tray && tray.destroy();
                    saveCount();
                    app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
                    app.quit()
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
                    tray && tray.destroy();
                    saveCount();
                    app.quit()
                }
            }
        ]);
        tray.setContextMenu(contextMenu);

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
            logger.debug('pdfFile :'+pdfFile + " | "+WebURL);
            if( fs.existsSync(pdfFile) )
            {
                addCount();
                res.set('Content-Type', 'application/json; charset=UTF-8');
                res.end( JSON.stringify({"ErrCode":0,"ErrInfo":"SUCCESS","PDFPath":pdfFile}) );
                return;
            }

            if(BrowserWindow.getAllWindows().length >= 5){
                let itr = queueTasks.find((item)=>item.WebURL == WebURL);
                if( !itr )
                {
                    queueTasks.push({WebURL,res});

                    logger.info(`添加任务 ${WebURL} 等待处理... | 当前现有排队的任务数：${queueTasks.length}`);
                }
                else{
                    
                    logger.info(`添加任务失败，有重复任务在等待了，关闭旧连接 ${WebURL} 等待处理... | 当前现有排队的任务数：${queueTasks.length}`);
                    itr.res.set('Content-Type', 'application/json; charset=UTF-8');
                    itr.res.end( JSON.stringify({"ErrCode":-1001,"ErrInfo":"","PDFPath":""}) );

                    itr.res = res;
                }
            }
            else
            {
                printPDF(WebURL,res);
            }
        }

        async function WebContentPrint(WebURL,webContent,res,finishHandle){
            let win = null;
            try {
                win = BrowserWindow.fromWebContents(webContent);
                const pdfDir = path.join( path.dirname(process.execPath),'pdfOuts');
                !fs.existsSync(pdfDir) && fs.mkdirSync(pdfDir);
                const md5 =  crypto.createHash('md5').update(WebURL).digest('hex');
                const pdfFile = path.join(pdfDir,`${md5}.pdf`);
                if( !fs.existsSync(pdfFile) )
                {
                    let handle_ = null;
                    process.platform == "win32" && (handle_ = setTimeout(()=>{
                        win && !win.isDestroyed() && win.webContents.isDevToolsOpened() && win.webContents.closeDevTools();
                        win && !win.isDestroyed() && win.close();
                        win = null;

                        const {exec} = require("child_process");
                        exec("sc stop spooler",{encoding:"utf-8"},(err,stdout,stderr)=>{
                            if(err)
                            {
                                logger.error(JSON.stringify(err));
                                logger.error(stdout);
                                logger.error(stderr);
                            }
                            else{
                                logger.info(stdout + stderr);
                            }
                            exec("sc start Spooler",{encoding:"utf-8"},(err,stdout,stderr)=>{
                                if(err)
                                {
                                    logger.error(JSON.stringify(err));
                                    logger.error(stdout);
                                    logger.error(stderr);
                                }
                                else{
                                    logger.info(stdout + stderr);
                                }

                                tray && tray.destroy();
                                app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
                                app.exit(0)
                            });
                        });
                    },5000));
                    const pdfData = await webContent.printToPDF({
                        printBackground: true
                    });
                    fs.writeFileSync(pdfFile,pdfData);
                    handle_ && (clearTimeout(handle_),handle_ = null);
                }
                
                try{
                    res.set('Content-Type', 'application/json; charset=UTF-8');
                    res.end( JSON.stringify({"ErrCode":0,"ErrInfo":"SUCCESS","PDFPath":pdfFile}) );
                    res = null;
                }
                catch{
                    let _ = [];
                    let p = path.join(__dirname,"fail.json");
                    fs.existsSync(p) && (_ = JSON.parse(fs.readFileSync(p,{encoding:"utf-8"})));
                    _.push({WebURL,pdfFile});
                    fs.writeFileSync(p,JSON.stringify(_));
                }
                addCount();
            } catch (error) {
                logger.error(error);
            }
            finally{
                finishHandle && clearTimeout(finishHandle);

                res && res.set('Content-Type', 'application/json; charset=UTF-8');
                res && res.end( JSON.stringify({"ErrCode":-1000,"ErrInfo":"","PDFPath":""}) );

                win && !win.isDestroyed() && win.webContents.isDevToolsOpened() && win.webContents.closeDevTools();
                win && !win.isDestroyed() && win.close();

                if(queueTasks.length > 0)
                {
                    let item = queueTasks.shift();
                    logger.info(`开始处理任务 ${item.WebURL} ... | 当前现有排队的任务数：${queueTasks.length}`);
                    setTimeout(printPDF,0,item.WebURL,item.res);
                }
            }
        }

        function printPDF(WebURL,res)
        {
            const win = CreateDefaultWin({width:1280,height:720, webPreferences: { offscreen: false,nodeIntegration:false,contextIsolation:true,preload: path.join(__dirname, 'preload.js'), } ,show:false});
            win.loadURL(WebURL);
            const finishHandle = setTimeout(WebContentPrint,30000,WebURL,win.webContents,res);
            win.webContents.on("ipc-message",async (e,channel,data)=>{
                if(channel != "NotifyPrint") return;
                WebContentPrint(WebURL,e.sender,res,finishHandle);
            });
        }

        
        // session.defaultSession.webRequest.onBeforeRequest(webRequestReq);
        // session.defaultSession.webRequest.onResponseStarted(webRequestRsp);
        // session.defaultSession.webRequest.onCompleted(webRequestRspCompleted);
        // session.defaultSession.webRequest.onErrorOccurred(webRequestRspCompleted);

        logger.info('load success');
    });

    app.on('window-all-closed', () => {
        app.quit()
    });
})();
function addCount(){
    pdfCount += 1;
    if(pdfCountDate == getDate()){
        pdfCountToday += 1;
    }
    else{
        pdfCountDate = getDate();
        pdfCountToday = 1;
    }
    saveCount();
    mainWindow && mainWindow.webContents.send("message",{
        log:`共计生成<strong class="pdfCount">${
            pdfCount
        }</strong>| 今日<strong class="pdfCountToday">${pdfCountToday}</strong>份报告`,pdfCount});
}
function saveCount(){
    try {
        let config = fs.existsSync(localConfig) ? JSON.parse(fs.readFileSync(localConfig)):{};
        config['pdfCount'] = pdfCount;
        config['pdfCountToday'] = pdfCountToday;
        config['pdfCountDate'] = pdfCountDate;
        fs.writeFileSync(localConfig,JSON.stringify(config));
    } catch (error) {
        logger.error(error);
    }
}
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
            contextIsolation:false,
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