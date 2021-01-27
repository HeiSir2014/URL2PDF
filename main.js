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
const port = 8888;


(function () {

    // 单例应用程序
    if (false && !app.requestSingleInstanceLock()) {
        app.quit()
        return
    }
    app.on('second-instance', (event, argv, cwd) => {
        const [win] = BrowserWindow.getAllWindows();
        console.log(win)
        if (win) {
            if (win.isMinimized()) {
                win.restore()
            }
            win.show()
            win.focus()
        } else {
            app.quit();
        }
    });
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

        session.defaultSession.webRequest.onBeforeRequest({urls:['*://*/*bridge-service/pdf.js*']},(details, callback)=>{
            callback({cancel:false,redirectURL:`http://127.0.0.1:${port}/pdf.js`})
        })

        logger.info('load success');
        appSvr.get('/api/Url2PDF/', function (req, res) {
            const WebURL = req.query['WebURL'];
            if (!WebURL) {
                res.status(404).send('WebURL is empty');
                return;
            }
            const win = CreateDefaultWin();
            win.webContents.once('ipc-message', function (e,channel) {
                if(channel != 'pdf-render-finish') return
                win.webContents.printToPDF({
                    printBackground:true,
                    marginsType: 0,
                    printSelectionOnly: false,
                    pageSize: 'A4',
                    scaleFactor: 100
                }).then(data => {
                    const file = Date.now() + '.pdf'
                    const pdfPath = path.join(__dirname, 'pdf',file );
                    !fs.existsSync(path.join(__dirname,'pdf')) && fs.mkdir(path.join(__dirname,'pdf'))
                    fs.writeFile(pdfPath, data, (error) => {
                        if (error) throw error
                        console.log(`Wrote PDF successfully to ${pdfPath}`)
                        res.send(`pdf/${file}`);
                        win.close();
                    });
                }).catch(error => {
                    res.send('503');
                    console.log(`Failed to write PDF to `, error)
                    win.close();
                });
            })
            win.loadURL(WebURL);
        });

        appSvr.listen(port, function (e) {
            logger.info(`server start success on ${port}`);
        });
        appSvr.use(express.static(__dirname));
    });

    app.on('window-all-closed', () => {
        //app.quit()
    });
})();

function CreateDefaultWin(options) {
    let opt = {
        width: 1280,
        height: 720,
        backgroundColor: '#ff2e2c29',
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
        show:false
    };
    if (options) {
        for (const key in options) {
            if (Object.hasOwnProperty.call(options, key)) {
                opt[key] = options[key];
            }
        }
    }
    let win = new BrowserWindow(opt);
    win.setMenu(null);
    return win;
}