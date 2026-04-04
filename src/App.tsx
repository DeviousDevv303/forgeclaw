import { useState } from 'react'
import { useAppStore } from './store'

function App() {
  const { user } = useAppStore()
  const [prompt, setPrompt] = useState('')

  return (
    <div style={{minHeight:'100vh',background:'#0f0f0f',color:'#e5e5e5'}}>
      <header style={{borderBottom:'1px solid #2a2a2a',padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{color:'#f97316',fontWeight:'bold',fontSize:'20px'}}>⚙ FORGECLAW</span>
        <span style={{color:'#6b6b6b',fontSize:'14px'}}>{user ? user.email : 'not connected'}</span>
      </header>
      <main style={{maxWidth:'700px',margin:'0 auto',padding:'64px 24px'}}>
        <h1 style={{fontSize:'36px',fontWeight:'bold',marginBottom:'8px'}}>Describe your app.</h1>
        <p style={{color:'#6b6b6b',marginBottom:'40px'}}>ForgeClaw will generate and deploy it to GitHub automatically.</p>
        <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',borderRadius:'8px',padding:'16px'}}>
          <textarea
            style={{width:'100%',background:'transparent',color:'#e5e5e5',border:'none',outline:'none',resize:'none',fontSize:'14px'}}
            rows={6}
            placeholder="A full-stack todo app with user auth..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:'12px'}}>
            <button
              style={{background:'#f97316',color:'white',padding:'8px 24px',borderRadius:'4px',border:'none',fontWeight:'600',cursor:'pointer'}}
              onClick={() => console.log('forge:', prompt)}
            >
              FORGE →
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
