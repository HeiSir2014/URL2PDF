# URL2PDF
URL2PDF,  An electron 、express server that can convert HTML into pdf file
## 实现原理 | comment
通过 Session WebRequest API 监控页面请求，当所有请求完成时，数据加载完毕后，开始执行printPDF功能，完整的打印所有页面内容。
> The page request is monitored through the Session WebRequest API. When all the requests are completed and the data is loaded, the printPDF function is executed to completely print all page content.

![UI](https://github.com/HeiSir2014/URL2PDF/raw/main/static/imgs/ui.png)
![UI2](https://github.com/HeiSir2014/URL2PDF/raw/main/static/imgs/ui-2.png)

### 2.1.2 之后的版本实现HTML通知转换PDF

在HTTML合适的位置调用 window.NotifyPrint 函数通知后台进行转换pdf。
比如在HTML页面加载完成调用，可以这么实现js.

```
document.onload = ()=>{
    if(window.NotifyPrint){
        window.NotifyPrint();
    }
}

```

## 需要注意 | notice
Windows 用户需要确保Windows服务中的Spooler服务处于开启的状态，否则会打印失败。
> Windows users need to ensure that the Spooler service in the Windows service is turned on, otherwise printing will fail.
## 使用接口 | API

HTTP：      /api/Url2PDF/?WebURL=xxx
Response：  PDF Binary Data