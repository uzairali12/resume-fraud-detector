// ================================================================
// app.js — Main Application Logic
// ================================================================

// ── CONFIG ────────────────────────────────────────────────────
// LOCAL DEV:  'http://localhost:8000'
// PRODUCTION: Replace with your Railway deployment URL
//   e.g.  'https://resume-fraud-api.up.railway.app'

const API_URL = 'http://localhost:8000'

// ── STATE ─────────────────────────────────────────────────────

let _file   = null   // currently selected File object
let _result = null   // last analysis result

// ── NAVIGATION ────────────────────────────────────────────────

const VIEWS = ['landing', 'dashboard', 'result', 'history']

function navigateTo(name) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`)
    if (el) el.classList.toggle('hidden', v !== name)
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (name === 'history') _loadHistory()
}

// ── UPLOAD: DRAG & DROP ───────────────────────────────────────

const uploadZone = document.getElementById('upload-zone')
const fileInput  = document.getElementById('file-input')

uploadZone.addEventListener('click', e => {
  // Only open file dialog if clicking the zone itself — not the remove button
  if (e.target.closest('.btn-icon') || e.target === fileInput) return
  if (!_file) fileInput.click()
})

uploadZone.addEventListener('dragover', e => {
  e.preventDefault()
  uploadZone.classList.add('drag-over')
})
uploadZone.addEventListener('dragleave', e => {
  if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over')
})
uploadZone.addEventListener('drop', e => {
  e.preventDefault()
  uploadZone.classList.remove('drag-over')
  const dropped = e.dataTransfer?.files?.[0]
  if (dropped) _handleFile(dropped)
})

fileInput.addEventListener('change', e => {
  const picked = e.target.files?.[0]
  if (picked) _handleFile(picked)
})

function _handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (!['pdf', 'docx', 'doc'].includes(ext)) {
    showToast('Only PDF and DOCX files are supported', 'error')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('File exceeds the 5 MB limit', 'error')
    return
  }

  _file = file

  // Show file preview
  document.getElementById('upload-idle').classList.add('hidden')
  document.getElementById('upload-selected').classList.remove('hidden')

  // Style the file type badge
  const badge = document.getElementById('file-type-badge')
  badge.textContent = ext.toUpperCase()
  const isPdf = ext === 'pdf'
  badge.style.background    = isPdf ? 'rgba(239,68,68,0.12)' : 'rgba(124,110,245,0.12)'
  badge.style.color         = isPdf ? '#EF4444' : '#7C6EF5'
  badge.style.border        = `1px solid ${isPdf ? 'rgba(239,68,68,0.4)' : 'rgba(124,110,245,0.4)'}`

  document.getElementById('file-name-display').textContent = file.name
  document.getElementById('file-size-display').textContent = _fmtSize(file.size)

  document.getElementById('analyze-btn').disabled = false
}

function clearFile() {
  _file = null
  fileInput.value = ''
  document.getElementById('upload-idle').classList.remove('hidden')
  document.getElementById('upload-selected').classList.add('hidden')
  document.getElementById('analyze-btn').disabled = true
}

// ── ANALYZE ───────────────────────────────────────────────────

async function analyzeResume() {
  if (!_file) return

  const btn     = document.getElementById('analyze-btn')
  const label   = document.getElementById('btn-label')
  const spinner = document.getElementById('btn-spinner')

  // Loading state
  btn.disabled = true
  label.classList.add('hidden')
  spinner.classList.remove('hidden')

  try {
    const form = new FormData()
    form.append('file', _file)

    const headers = {}
    const token = await getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${API_URL}/predict`, {
      method : 'POST',
      headers,
      body   : form
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new Error(body.detail || `HTTP ${res.status}`)
    }

    _result = await res.json()
    _renderResult(_result)
    navigateTo('result')

  } catch (err) {
    showToast(`Analysis failed: ${err.message}`, 'error')
  } finally {
    btn.disabled = !_file
    label.classList.remove('hidden')
    spinner.classList.add('hidden')
  }
}

// ── RENDER RESULT ─────────────────────────────────────────────

function _renderResult(data) {
  const isFraud = data.label === 1
  const pct     = Math.round(data.confidence * 100)
  const cls     = isFraud ? 'fraud' : 'genuine'

  // Header
  document.getElementById('result-filename').textContent = data.filename
  document.getElementById('result-date').textContent     = _fmtDate(data.analyzed_at)

  // Verdict badge
  const badge = document.getElementById('verdict-badge')
  badge.className   = `verdict-badge ${cls}`
  badge.innerHTML   = isFraud
    ? '<i class="ti ti-alert-triangle" aria-hidden="true"></i> Fraud Detected'
    : '<i class="ti ti-shield-check"   aria-hidden="true"></i> Appears Genuine'

  // Confidence bar — small delay so the CSS transition plays
  const fill = document.getElementById('confidence-fill')
  fill.className = `confidence-fill ${cls}`
  fill.style.width = '0'
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { fill.style.width = `${pct}%` })
  })
  document.getElementById('confidence-value').textContent = `${pct}% confidence`

  // Signal breakdown cards
  const s = data.signals
  const signalDefs = [
    { label: 'Word count',       value: s.word_count,              thresh: null   },
    { label: 'Sentences',        value: s.sentence_count,          thresh: null   },
    { label: 'Vague language',   value: s.vague_language_count,    thresh: 2      },
    { label: 'Buzzwords',        value: s.buzzword_count,          thresh: 3      },
    { label: 'Prestige claims',  value: s.prestige_keyword_count,  thresh: 2      },
    { label: 'Exp. years total', value: `${s.experience_years_sum}y`, thresh: null, alertIf: s.experience_years_sum > 20 },
    { label: 'Date overlaps',    value: s.date_overlap_count,      thresh: 1      },
  ]

  document.getElementById('signals-grid').innerHTML = signalDefs.map(sig => {
    const isAlert = sig.alertIf !== undefined ? sig.alertIf : (sig.thresh !== null && sig.value >= sig.thresh)
    return `
      <div class="signal-item">
        <div class="signal-label">${sig.label}</div>
        <div class="signal-value${isAlert ? ' alert' : ''}">${sig.value}</div>
      </div>`
  }).join('')

  // Flags / recommendations
  const flagsEl = document.getElementById('flags-section')
  if (s.flags && s.flags.length > 0) {
    flagsEl.innerHTML = s.flags.map(f => `
      <div class="flag-item bad">
        <i class="ti ti-alert-triangle" aria-hidden="true"></i>
        <span>${f}</span>
      </div>`).join('')
  } else {
    flagsEl.innerHTML = `
      <div class="flag-item good">
        <i class="ti ti-circle-check" aria-hidden="true"></i>
        <span>No specific fraud signals detected in this resume.</span>
      </div>`
  }
}

// ── HISTORY ───────────────────────────────────────────────────

async function _loadHistory() {
  const loading  = document.getElementById('history-loading')
  const empty    = document.getElementById('history-empty')
  const tableWrap = document.getElementById('history-table-wrap')
  const emptyMsg = document.getElementById('history-empty-msg')

  loading.classList.remove('hidden')
  empty.classList.add('hidden')
  tableWrap.classList.add('hidden')

  const token = await getAccessToken()
  if (!token) {
    loading.classList.add('hidden')
    emptyMsg.innerHTML = `Sign in to see your history. <a href="#" onclick="openAuth()">Sign in →</a>`
    empty.classList.remove('hidden')
    return
  }

  try {
    const res = await fetch(`${API_URL}/history?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    loading.classList.add('hidden')

    if (!data.history?.length) {
      emptyMsg.textContent = 'No analyses yet.'
      empty.classList.remove('hidden')
      return
    }

    document.getElementById('history-body').innerHTML = data.history.map(row => `
      <tr>
        <td style="color:var(--text);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${_escHtml(row.filename)}
        </td>
        <td><span class="verdict-pill ${row.prediction}">${row.prediction}</span></td>
        <td style="font-family:var(--font-mono);font-size:13px">${Math.round(row.confidence * 100)}%</td>
        <td style="font-size:13px;white-space:nowrap">${_fmtDate(row.analyzed_at)}</td>
        <td>
          <button class="btn-delete" data-id="${row.id}" onclick="deleteRecord('${row.id}', this)">
            Delete
          </button>
        </td>
      </tr>`).join('')

    tableWrap.classList.remove('hidden')

  } catch (err) {
    loading.classList.add('hidden')
    emptyMsg.textContent = 'Could not load history.'
    empty.classList.remove('hidden')
    showToast(`Failed to load history: ${err.message}`, 'error')
  }
}

async function deleteRecord(id, btn) {
  const token = await getAccessToken()
  if (!token) return

  const originalText = btn.textContent
  btn.textContent = '…'
  btn.disabled = true

  try {
    const res = await fetch(`${API_URL}/history/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    btn.closest('tr').remove()
    showToast('Record deleted', 'success')

    // Show empty state if no rows left
    if (!document.getElementById('history-body').children.length) {
      document.getElementById('history-table-wrap').classList.add('hidden')
      document.getElementById('history-empty-msg').textContent = 'No analyses yet.'
      document.getElementById('history-empty').classList.remove('hidden')
    }
  } catch {
    btn.textContent = originalText
    btn.disabled = false
    showToast('Could not delete record', 'error')
  }
}

// ── TOASTS ────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const iconMap = { success: 'ti-circle-check', error: 'ti-alert-circle', info: 'ti-info-circle' }
  const icon = iconMap[type] || iconMap.info

  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i><span>${_escHtml(message)}</span>`
  container.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity   = '0'
    toast.style.transform = 'translateX(24px)'
    setTimeout(() => toast.remove(), 280)
  }, 3500)
}

// ── UTILS ─────────────────────────────────────────────────────

function _fmtSize(bytes) {
  if (bytes < 1024)          return `${bytes} B`
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function _fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).format(new Date(iso))
  } catch { return iso }
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── INIT ──────────────────────────────────────────────────────

;(async function init() {
  const user = await getCurrentUser()
  if (user) {
    _updateNavbar(user)
    navigateTo('dashboard')
  } else {
    navigateTo('landing')
  }
})()