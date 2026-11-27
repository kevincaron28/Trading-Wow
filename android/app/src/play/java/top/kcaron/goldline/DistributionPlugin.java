package top.kcaron.goldline;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

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

    /** Google Play's in-app rating window. Play decides whether it appears and never reports what the user did. */
    @PluginMethod
    public void requestReview(PluginCall call) {
        ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(request -> {
            if (!request.isSuccessful() || getActivity() == null) {
                call.reject("The rating window is not available");
                return;
            }
            manager.launchReviewFlow(getActivity(), request.getResult()).addOnCompleteListener(done -> call.resolve());
        });
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        call.reject("Updates come from Google Play in this build");
    }
}
