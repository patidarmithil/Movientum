import React, { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

const COLORS = ['#FF4D6D', '#F5A623', '#56CFE1', '#06D6A0'];

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminService.getAdminAnalytics()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner"></div>;
  if (!data) return <p>Failed to load analytics.</p>;

  return (
    <div className="admin-analytics fade-in">
      <div className="admin-charts-grid">
        
        {/* Rating Distribution (Pie Chart) */}
        <div className="admin-stat-card" style={{ height: '350px' }}>
          <h3>Rating Distribution</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.rating_distribution}
                dataKey="count"
                nameKey="category"
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              >
                {data.rating_distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top Watched Movies (Bar Chart) */}
        <div className="admin-stat-card" style={{ height: '350px' }}>
          <h3>Top 10 Watched Movies</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.top_watched}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis type="number" stroke="#a0aec0" />
              <YAxis dataKey="title" type="category" width={120} stroke="#a0aec0" tick={{fontSize: 12}} />
              <RechartsTooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)' }} />
              <Bar dataKey="watch_count" fill="#56CFE1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Daily Activity (Line Chart) */}
        <div className="admin-stat-card" style={{ height: '350px', gridColumn: '1 / -1' }}>
          <h3>Watches (Last 48 Hours)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.daily_activity} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="time" stroke="#a0aec0" />
              <YAxis stroke="#a0aec0" />
              <RechartsTooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)' }} />
              <Line type="monotone" dataKey="watches" stroke="#06D6A0" strokeWidth={3} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Database Health (Bar Chart) */}
        <div className="admin-stat-card" style={{ height: '350px' }}>
          <h3>Database Health</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.db_health}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="table" stroke="#a0aec0" tick={{fontSize: 12}} />
              <YAxis stroke="#a0aec0" />
              <RechartsTooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)' }} />
              <Bar dataKey="count" fill="#F5A623" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Click Distribution (Pie Chart) */}
        <div className="admin-stat-card" style={{ height: '350px' }}>
          <h3>Click Distribution (Media Type)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.click_distribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              >
                {data.click_distribution && data.click_distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}
