'use client'

import { useEffect, useRef } from 'react'
import { COLORS } from '@/lib/constants'
import {
  Chart,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, BarController, LineController,
} from 'chart.js'

Chart.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, BarController, LineController,
)

interface ChartConfig {
  type: 'bar' | 'line'
  labels: string
  datasets: string
  title: string
}

export function ArticleCharts() {
  const initialised = useRef(false)

  useEffect(() => {
    if (initialised.current) return
    initialised.current = true

    const containers = document.querySelectorAll('.article-chart[data-chart]')
    containers.forEach((el) => {
      try {
        const raw = el.getAttribute('data-chart') ?? '{}'
        const config: ChartConfig = JSON.parse(decodeURIComponent(raw))
        const labels: string[] = JSON.parse(config.labels)
        const datasets: { label: string; data: number[] }[] = JSON.parse(config.datasets)

        // Replace placeholder div with canvas
        el.innerHTML = ''
        const wrapper = document.createElement('div')
        wrapper.className = 'article-chart-container'
        const canvas = document.createElement('canvas')
        wrapper.appendChild(canvas)
        el.appendChild(wrapper)

        if (config.title) {
          const h4 = document.createElement('p')
          h4.textContent = config.title
          h4.style.cssText = 'font-size:0.8rem;font-weight:700;text-align:center;margin-bottom:0.75rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.05em'
          el.insertBefore(h4, wrapper)
        }

        new Chart(canvas, {
          type: config.type,
          data: {
            labels,
            datasets: datasets.map((ds, i) => ({
              label: ds.label,
              data: ds.data,
              backgroundColor: i === 0 ? 'rgba(201,162,39,0.7)' : 'rgba(26,39,68,0.7)',
              borderColor: i === 0 ? COLORS.GOLD : COLORS.NAVY,
              borderWidth: 1.5,
              tension: 0.3,
              fill: false,
              pointRadius: 4,
            })),
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: { display: datasets.length > 1 },
              tooltip: { mode: 'index' as const, intersect: false },
            },
            scales: {
              y: { beginAtZero: true, grid: { color: 'rgba(201,162,39,0.1)' } },
              x: { grid: { display: false } },
            },
          },
        })
      } catch (e) {
        console.error('Chart render error:', e)
      }
    })
  }, [])

  return null
}
