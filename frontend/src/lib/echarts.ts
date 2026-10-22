/**
 * Explicit ECharts registration.
 *
 * The full `echarts` bundle ships every chart type and component (≈1 MB before
 * gzip) even though this application only draws six series types. Registering
 * exactly what the labs use keeps the chart vendor chunk small without changing
 * any option object.
 */
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  // Series types
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  PieChart,
  // Components
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  VisualMapComponent,
  DataZoomComponent,
  // Features and renderer
  LabelLayout,
  CanvasRenderer,
])

export { echarts }
