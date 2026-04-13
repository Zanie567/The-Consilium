'use client'

import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  data: { label: string; value: number }[]
}

export function TrafficChart({ data }: Props) {
  const chartData = {
    labels: data.map((d) => d.label),
    datasets: [
      {
        data: data.map((d) => d.value),
        backgroundColor: 'rgba(201, 162, 39, 0.45)',
        borderColor: '#c9a227',
        borderWidth: 1,
        borderRadius: 2,
      },
    ],
  }

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 3.5,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a2744',
        titleColor: '#c9a227',
        bodyColor: '#faf8f3',
        padding: 10,
        callbacks: {
          label: (item) => ` ${(item.raw as number).toLocaleString()} views`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(26, 39, 68, 0.45)',
          font: { size: 10 },
          maxRotation: 0,
          maxTicksLimit: 10,
        },
        border: { display: false },
      },
      y: {
        grid: { color: 'rgba(26, 39, 68, 0.06)' },
        ticks: {
          color: 'rgba(26, 39, 68, 0.45)',
          font: { size: 10 },
          maxTicksLimit: 5,
        },
        border: { display: false },
        beginAtZero: true,
      },
    },
  }

  return <Bar data={chartData} options={options} />
}
