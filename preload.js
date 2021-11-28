const { contextBridge,ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('NotifyPrint', function(){
    ipcRenderer.send("NotifyPrint");
})