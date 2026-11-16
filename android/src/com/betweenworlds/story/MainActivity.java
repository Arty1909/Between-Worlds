package com.betweenworlds.story;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.util.*;

/** Bundled HTTPS origin with byte-range streaming; no server or Internet permission. */
public final class MainActivity extends Activity {
  private static final String HOST="appassets.androidplatform.net";
  private WebView web;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    if(BuildTarget.ARM64_ONLY)System.loadLibrary("bw_abi_guard");
    FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(25,23,37));
    web=new WebView(this);web.setBackgroundColor(Color.rgb(25,23,37));
    frame.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(frame);
    if(Build.VERSION.SDK_INT>=30){
      getWindow().setDecorFitsSystemWindows(false);
      frame.setOnApplyWindowInsetsListener((v,w)->{
        Insets i=w.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
        v.setPadding(i.left,i.top,i.right,i.bottom);return w;
      });
    }else frame.setFitsSystemWindows(true);
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);s.setTextZoom(100);
    s.setSupportZoom(true);s.setBuiltInZoomControls(true);s.setDisplayZoomControls(false);
    s.setMediaPlaybackRequiresUserGesture(false);s.setCacheMode(WebSettings.LOAD_NO_CACHE);
    CookieManager.getInstance().setAcceptCookie(false);
    WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);
    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !local(r.getUrl());}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){return asset(r);}
    });
    web.loadUrl("https://"+HOST+"/index.html");
  }
  private boolean local(Uri uri){return "https".equals(uri.getScheme())&&HOST.equals(uri.getHost());}
  private WebResourceResponse empty(int code,String reason){return new WebResourceResponse("text/plain","UTF-8",code,reason,Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
  private WebResourceResponse asset(WebResourceRequest r){
    if(!local(r.getUrl()))return empty(403,"Forbidden");
    String path=r.getUrl().getPath();if(path==null)return empty(404,"Not Found");
    if(path.equals("/"))path="/index.html";
    if(path.contains("..")||path.contains("\\"))return empty(403,"Forbidden");
    path="site"+path;
    String ext=path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
    String mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
    if(ext.equals("js"))mime="text/javascript";
    if(ext.equals("json")||ext.equals("webmanifest"))mime="application/json";
    if(mime==null)mime="application/octet-stream";
    Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");
    try{
      if(ext.equals("mp4")||ext.equals("mp3")){
        // WebView performs the initial Range skip on intercepted streams itself.
        // Start at byte zero and bound the END only, so the offset is applied once.
        AssetFileDescriptor fd=getAssets().openFd(path);long length=fd.getLength(),start=0,end=length-1;
        String range=null;for(Map.Entry<String,String> h:r.getRequestHeaders().entrySet())if(h.getKey().equalsIgnoreCase("Range"))range=h.getValue();
        boolean partial=range!=null;
        if(partial){
          if(!range.matches("bytes=\\d*-\\d*")){fd.close();return empty(416,"Range Not Satisfiable");}
          String[] pair=range.substring(6).split("-",-1);
          if(pair[0].isEmpty())start=Math.max(0,length-Long.parseLong(pair[1]));
          else{start=Long.parseLong(pair[0]);if(!pair[1].isEmpty())end=Math.min(end,Long.parseLong(pair[1]));}
          if(start>=length||start>end){fd.close();return empty(416,"Range Not Satisfiable");}
          headers.put("Content-Range","bytes "+start+"-"+end+"/"+length);
        }
        // Chromium supplies Content-Length from available(); adding it duplicates it.
        headers.put("Accept-Ranges","bytes");
        return new WebResourceResponse(mime,null,partial?206:200,partial?"Partial Content":"OK",headers,new LimitedStream(fd.createInputStream(),end+1));
      }
      if(ext.equals("html"))headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'");
      return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(path));
    }catch(Exception e){return empty(404,"Not Found");}
  }
  private static class LimitedStream extends FilterInputStream {
    private long remaining;LimitedStream(InputStream in,long count){super(in);remaining=count;}
    @Override public int read()throws IOException{if(remaining<=0)return -1;int v=super.read();if(v>=0)remaining--;return v;}
    @Override public int read(byte[] b,int off,int len)throws IOException{if(remaining<=0)return -1;int n=in.read(b,off,(int)Math.min(len,remaining));if(n>0)remaining-=n;return n;}
    @Override public long skip(long n)throws IOException{long skipped=in.skip(Math.min(Math.max(0,n),remaining));remaining-=skipped;return skipped;}
    @Override public int available()throws IOException{return (int)Math.min(in.available(),remaining);}
  }
  private void visibility(boolean hidden){if(web!=null)web.evaluateJavascript("if(typeof music!=='undefined'){music.visibility("+hidden+");effects.visibility("+hidden+");backdrop.configure(prefs.animation,"+hidden+");}",null);}
  @Override protected void onPause(){visibility(true);if(web!=null)web.onPause();super.onPause();}
  @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();visibility(false);}}
  @Override public void onBackPressed(){
    web.evaluateJavascript("(()=>{if(typeof $==='undefined')return false;if($('modal').open){closeModal();return true;}if(document.body.classList.contains('scenery-mode')){$('scenery-toggle').click();return true;}if(typeof screen!=='undefined'&&screen!=='home'){home();return true;}return false;})()",value->{
      if(!"true".equals(value))new AlertDialog.Builder(this).setMessage("Close Between Worlds?").setNegativeButton("Cancel",null).setPositiveButton("Close",(d,w)->finish()).show();
    });
  }
  @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
