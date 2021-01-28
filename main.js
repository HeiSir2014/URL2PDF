const os = require('os');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
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
const appSvr = express();
let timeouts = {};
let dbHandle = {};

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

        const param = getStartParam();
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

        async function timeoutResp(webContentsId)
        {
            let res = dbHandle[webContentsId];  res && (delete dbHandle[webContentsId]);
            const content = webContents.fromId(webContentsId);
            const win = content?BrowserWindow.fromWebContents(content):null;
            if(res == null) {
                win && win.close();
                return;
            };
            console.log('timeoutResp',webContentsId)
            try{
                const pdfData = await content.printToPDF({
                    printBackground: true,
                    marginsType: 1,
                    printSelectionOnly: false,
                    landscape: false,
                    pageSize: 'A4',
                    scaleFactor: 70
                });
                res.set('Content-Type', 'application/pdf');
                res.end(pdfData);
                res = null;
            }
            catch(error){
                console.log(error)
            }
            finally{
                res && res.status(404).send();
                win && win.close();
            }
        }

        function webRequestReq(details, callback){
            if(!details.webContentsId) {
                callback({cancel:false});return
            }
            const id = details.webContentsId;
            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
            callback({cancel:false});
        };

        function webRequestRsp(details){
            if(!details.webContentsId) {
                return
            }
            const id = details.webContentsId;
            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
        }
        
        function webRequestRspCompleted(details){
            if(!details.webContentsId) {return}
            const id = details.webContentsId;

            timeouts[id] && (clearTimeout(timeouts[id]),delete timeouts[id]);
            timeouts[id] = setTimeout( timeoutResp,500,id );
        }
        
        session.defaultSession.webRequest.onBeforeRequest(webRequestReq);
        session.defaultSession.webRequest.onResponseStarted(webRequestRsp);
        session.defaultSession.webRequest.onCompleted(webRequestRspCompleted);

        logger.info('load success');

        appSvr.get('/api/Url2PDF/', function (req, res) {
            const WebURL = req.query['WebURL'];
            if (!WebURL) {
                res.status(404).send('WebURL is empty');
                return;
            }
            const win = CreateDefaultWin({width:1,height:1, webPreferences: { offscreen: true } ,show:false});
            win.loadURL(WebURL);
            dbHandle[win.webContents.id] = res;
        });

        appSvr.listen(param.port, function (e) {
            logger.info(`server start success on ${param.port}`);
        });
    });

    app.on('window-all-closed', () => {
        //app.quit()
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
            webSecurity: !isDev
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