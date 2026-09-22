// Loaded lazily from FeedbackCenter so recharts only ships when this section
// is scrolled near.
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SIGNAL_META, shortDate } from './analysisUtils'

const ORDER = ['watched', 'watchlist', 'thumbs_up', 'thumbs_down', 'click']

function TooltipBody({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p) => p.value > 0)
  return (
    <div className="an-tooltip">
      <p className="an-tooltip__date">{shortDate(label)}</p>
      {rows.length === 0 && <p className="an-muted">No signals</p>}
      {rows.map((p) => (
        <p key={p.dataKey}>
          <span className="an-dot" style={{ background: SIGNAL_META[p.dataKey].color }} />
          {SIGNAL_META[p.dataKey].label} <b className="an-num">{p.value}</b>
        </p>
      ))}
    </div>
  )
}

export default function SignalTimeline({ data, hidden = [] }) {
  const keys = ORDER.filter((k) => !hidden.includes(k))
  return (
    <div className="an-timeline" role="img" aria-label="Your feedback signals per day">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: '#9CA3AF', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis allowDecimals={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<TooltipBody />} cursor={{ stroke: 'rgba(255,255,255,.2)' }} />
          {keys.map((k) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="1"
              stroke={SIGNAL_META[k].color}
              fill={SIGNAL_META[k].color}
              fillOpacity={0.28}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
