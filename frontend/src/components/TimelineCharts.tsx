import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Props = { data: any[] };

export function TimelineCharts({ data }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-72 rounded border border-slate-700 p-3">
        <h3 className="mb-2 font-semibold">Alan & RGR</h3>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey="area_px" stroke="#22c55e" />
            <Line dataKey="area_based_rgr" stroke="#38bdf8" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72 rounded border border-slate-700 p-3">
        <h3 className="mb-2 font-semibold">Stres Trendleri</h3>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey="stress_score" stroke="#f97316" />
            <Line dataKey="GLI" stroke="#22c55e" />
            <Line dataKey="RednessIndex" stroke="#ef4444" />
            <Line dataKey="YellowingIndex" stroke="#eab308" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
