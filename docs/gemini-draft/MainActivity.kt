package top.kcaron.wowah

import android.graphics.Color
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.tradingview.lightweightcharts.api.chart.models.color.surface.SolidColor
import com.tradingview.lightweightcharts.api.chart.models.color.toIntColor
import com.tradingview.lightweightcharts.api.options.models.layoutOptions
import com.tradingview.lightweightcharts.api.options.models.localizationOptions
import com.tradingview.lightweightcharts.api.series.models.BarData
import com.tradingview.lightweightcharts.api.series.models.PriceFormatter
import com.tradingview.lightweightcharts.api.series.models.Time
import com.tradingview.lightweightcharts.view.ChartsView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray

class MainActivity : AppCompatActivity() {
    private val http = OkHttpClient()
    private val backendUrl = "http://10.0.2.2:8000"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val chartsView = ChartsView(this)
        setContentView(chartsView)

        chartsView.api.applyOptions {
            layout = layoutOptions {
                background = SolidColor(Color.parseColor("#0B0F19").toIntColor())
                textColor = Color.parseColor("#94A3B8").toIntColor()
            }
            localization = localizationOptions {
                priceFormatter = PriceFormatter(template = "{price:#0:#0}c")
            }
        }

        chartsView.api.addCandlestickSeries { series ->
            lifecycleScope.launch {
                val bars = fetchCandles(90002)
                series.setData(bars)
            }
        }
    }

    private suspend fun fetchCandles(itemId: Int): List<BarData> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$backendUrl/api/candles/$itemId").build()
        http.newCall(req).execute().use { resp ->
            val arr = JSONArray(resp.body?.string() ?: "[]")
            List(arr.length()) { i ->
                val obj = arr.getJSONObject(i)
                BarData(
                    time = Time.Utc(obj.getLong("time")),
                    open = obj.getLong("open").toFloat(),
                    high = obj.getLong("high").toFloat(),
                    low = obj.getLong("low").toFloat(),
                    close = obj.getLong("close").toFloat()
                )
            }
        }
    }
}
