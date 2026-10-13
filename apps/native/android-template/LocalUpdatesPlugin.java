package ai.mavrika.mirkamline;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="LocalUpdates")
public class LocalUpdatesPlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean checking=new AtomicBoolean(false);
    @PluginMethod public void ready(PluginCall call){JSObject result=new JSObject();result.put("version",LocalUpdates.ready(getContext()));call.resolve(result);}
    @PluginMethod public void check(PluginCall call){
        if(!checking.compareAndSet(false,true)){JSObject result=new JSObject();result.put("busy",true);call.resolve(result);return;}
        worker.execute(()->{try{call.resolve(new JSObject(LocalUpdates.check(getContext()).toString()));}catch(Exception error){call.reject("Update unavailable",error);}finally{checking.set(false);}});
    }
    @Override protected void handleOnDestroy(){worker.shutdown();}
}
