import { useState } from 'react'

function App() {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('idle')

  function handleForge() {
    if (prompt.trim() === '') return
    setStatus('generating')
    setTimeout(() => setStatus('idle'), 3000)
  }

  return (
    <div style={{minHeight:'100vh',background:'#0f0f0f',color:'#e5e5e5',fontFamily:'monospace'}}>
      <header style={{borderBottom:'1px solid #2a2a2a',padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <span style={{color:'#f97316',fontSize:'20px'}}>⚙</span>
          <span style={{color:'#f97316',fontWeight:'bold',fontSize:'18px',letterSpacing:'2px'}}>FORGECLAW</span>
          <span style={{color:'#6b6b6b',fontSize:'12px'}}>autonomous app forge</span>
        </div>
      </header>
      <main style={{maxWidth:'680px',margin:'0 auto',padding:'80px 24px'}}>
        <h1 style={{fontSize:'40px',fontWeight:'bold',marginBottom:'8px'}}>Describe your app.</h1>
        <p style={{color:'#6b6b6b',marginBottom:'40px',fontSize:'15px'}}>ForgeClaw will generate and deploy it to GitHub automatically.</p>
        <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',borderRadius:'8px',padding:'16px'}}>
          <textarea
            style={{width:'100%',background:'transparent',color:'#e5e5e5',border:'none',outline:'none',resize:'none',fontSize:'14px',lineHeight:'1.6',fontFamily:'monospace'}}
            rows={6}
            placeholder="A full-stack todo app with user auth..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:'12px'}}>
            <button
              style={{background: status === 'generating' ? '#7c3316' : '#f97316',color:'white',padding:'8px 24px',borderRadius:'4px',border:'none',fontWeight:'600',cursor:'pointer',fontSize:'13px'}}
              onClick={handleForge}
            >
              {status === 'generating' ? 'FORGING...' : 'FORGE'}
            </button>
          </div>
        </div>
        {status === 'generating' && (
          <div style={{marginTop:'24px',padding:'16px',background:'#1a1a1a',border:'1px solid #f97316',borderRadius:'8px'}}>
            <p style={{color:'#f97316',fontSize:'13px'}}>Generating your app...</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
