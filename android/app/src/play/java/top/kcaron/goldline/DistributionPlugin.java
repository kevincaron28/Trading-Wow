package top.kcaron.goldline;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Google Play build: updates come from Play (in-app update prompt); this build never installs APKs itself. */
@CapacitorPlugin(name = "Distribution")
public class DistributionPlugin extends Plugin {
    @PluginMethod
    public void getChannel(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("channel", "play");
        ret.put("canInstall", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        call.reject("Updates come from Google Play in this build");
    }
}
