package top.kcaron.goldline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Distribution: "play" or "sideload" build (each flavor has its own implementation).
        registerPlugin(DistributionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
