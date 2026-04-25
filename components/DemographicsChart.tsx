import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export function DemographicsChart({ data, colors }: { data: { name: string; percentage: number }[], colors: string[] }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((d) => ({ name: d.name, value: d.percentage }));

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="99%" height="100%" minWidth={0} minHeight={0}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={65}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {chartData.map((entry, index) => {
              const isOther = entry.name === 'Other';
              const color = isOther ? colors[colors.length - 1] : colors[index % (colors.length - 1)];
              return <Cell key={`cell-${index}`} fill={color} />;
            })}
          </Pie>
          <Tooltip 
            formatter={(value: any) => [`${value}%`, undefined]}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            itemStyle={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
