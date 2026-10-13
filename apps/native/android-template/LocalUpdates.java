package ai.mavrika.mirkamline;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;

final class LocalUpdates {
    static final int LIMIT=12*1024*1024;
    static final String[] FILES={"index.html","app.js","style.css","install.js","connection.js","updates.js","icon-192.png","icon-512.png","brand-logo.png"};
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("ui-updates-0.4",Context.MODE_PRIVATE);}
    static File root(Context c){File r=new File(c.getFilesDir(),"ui-updates-0.4");r.mkdirs();return r;}
    static synchronized String start(Context c){
        SharedPreferences p=prefs(c);int current=p.getInt("current",0),previous=p.getInt("previous",0),pending=p.getInt("pending",0);boolean trial=false;
        if(p.getBoolean("trial",false)){current=previous;pending=0;}
        if(pending>0){previous=current;current=pending;trial=true;}
        File folder=new File(root(c),String.valueOf(current));
        if(current>0&&!new File(folder,"index.html").isFile()){current=0;trial=false;}
        p.edit().putInt("current",current).putInt("previous",previous).putInt("pending",0).putBoolean("trial",trial).commit();
        return current==0?null:folder.getAbsolutePath();
    }
    static synchronized int ready(Context c){prefs(c).edit().putBoolean("trial",false).commit();
        SharedPreferences state=prefs(c);File[] entries=root(c).listFiles();
        if(entries!=null)for(File entry:entries)if(entry.getName().matches("[0-9]+")){try{int v=Integer.parseInt(entry.getName());if(v!=state.getInt("current",0)&&v!=state.getInt("previous",0)&&v!=state.getInt("pending",0))remove(entry);}catch(NumberFormatException ignored){}}
        return Math.max(1,prefs(c).getInt("current",0));}
    static byte[] read(InputStream in,int max) throws Exception {
        try(InputStream stream=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n,total=0;
            while((n=stream.read(buffer))!=-1){total+=n;if(total>max)throw new IOException("Update too large");out.write(buffer,0,n);}return out.toByteArray();
        }
    }
    static void remove(File f){if(f.isDirectory()){File[] files=f.listFiles();if(files!=null)for(File child:files)remove(child);}f.delete();}
    static synchronized JSONObject stage(Context c,byte[] envelope) throws Exception {
        if(envelope.length>LIMIT)throw new IOException("Update too large");
        JSONObject outer=new JSONObject(new String(envelope,StandardCharsets.UTF_8));
        byte[] bytes=Base64.decode(outer.getString("payload"),Base64.DEFAULT);
        String pem=new String(read(c.getAssets().open("update-public.pem"),10000),StandardCharsets.UTF_8).replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
        Signature verifier=Signature.getInstance("SHA256withRSA");
        verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.decode(pem,Base64.DEFAULT))));
        verifier.update(bytes);
        if(!verifier.verify(Base64.decode(outer.getString("signature"),Base64.DEFAULT)))throw new SecurityException("Invalid update signature");
        JSONObject data=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        long versionLong=data.getLong("version");
        if(!"0.4".equals(data.getString("compatibility"))||!"android".equals(data.getString("platform"))||versionLong<1||versionLong>Integer.MAX_VALUE||data.getDouble("version")!=versionLong)throw new SecurityException("Incompatible update");
        int version=(int)versionLong;JSONObject files=data.getJSONObject("files");
        if(files.length()!=FILES.length)throw new SecurityException("Invalid file list");
        Map<String,byte[]> decoded=new HashMap<>();int size=0;
        for(String name:FILES){byte[] content=Base64.decode(files.getString(name),Base64.DEFAULT);size+=content.length;if(content.length==0||size>8*1024*1024)throw new IOException("Invalid file size");decoded.put(name,content);}
        if(!new String(decoded.get("index.html"),StandardCharsets.UTF_8).contains("id=\"suite-home\""))throw new SecurityException("Invalid home");
        SharedPreferences p=prefs(c);
        if(version<=p.getInt("highest",1))return new JSONObject().put("available",p.getInt("pending",0)>0).put("version",Math.max(1,p.getInt("current",0)));
        File temporary=new File(root(c),"staging"),target=new File(root(c),String.valueOf(version));remove(temporary);temporary.mkdirs();
        try{
            for(String name:FILES)try(FileOutputStream out=new FileOutputStream(new File(temporary,name))){out.write(decoded.get(name));out.getFD().sync();}
            try(FileOutputStream out=new FileOutputStream(new File(temporary,"native-bridge.js"))){out.write(read(c.getAssets().open("public/native-bridge.js"),2*1024*1024));}
            remove(target);if(!temporary.renameTo(target))throw new IOException("Cannot activate update");
            if(!p.edit().putInt("pending",version).putInt("highest",version).commit())throw new IOException("Cannot save update state");
            return new JSONObject().put("available",true).put("version",version);
        }catch(Exception e){remove(temporary);throw e;}
    }
    static JSONObject check(Context c) throws Exception {
        HttpURLConnection conn=(HttpURLConnection)new URL("https://raw.githubusercontent.com/MARK-avigail/mirkam-line/main/updates/android.json").openConnection();
        String etag=prefs(c).getString("etag",null);if(etag!=null)conn.setRequestProperty("If-None-Match",etag);
        conn.setConnectTimeout(10000);conn.setReadTimeout(20000);conn.setInstanceFollowRedirects(false);conn.setUseCaches(false);
        try{int status=conn.getResponseCode();if(status==304)return new JSONObject().put("available",prefs(c).getInt("pending",0)>0);
            if(status!=200)throw new IOException("Update service unavailable");
            JSONObject result=stage(c,read(conn.getInputStream(),LIMIT));String tag=conn.getHeaderField("ETag");if(tag!=null)prefs(c).edit().putString("etag",tag).commit();return result;}finally{conn.disconnect();}
    }
}
