// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assessNexusOutputQuality, inferNexusWebGpuStage, isWebGpuDeviceLossError, sanitizeNexusWebGpuDiagnostic } from './nexusWebGpuProvider'

describe('NEXUS WebGPU diagnostics', () => {
  it('accepts readable responses across scripts without penalizing ordinary multilingual text', () => {
    expect(assessNexusOutputQuality('Light is a metaphor here, not an established scientific fact.').valid).toBe(true)
    expect(assessNexusOutputQuality('La luz puede ser una metáfora poderosa, no una prueba científica.').valid).toBe(true)
    expect(assessNexusOutputQuality('光は人間の意識を表す比喩として語ることができます。').valid).toBe(true)
  })

  it('rejects corrupted Unicode, repeated mixed-script words, identifier dumps, and runtime statuses', () => {
    expect(assessNexusOutputQuality(`Broken ${'\uFFFD'.repeat(8)} output`).valid).toBe(false)
    const mixed = 'aБ字cД字eЖ字'
    expect(assessNexusOutputQuality(Array(8).fill(mixed).join(' ')).reason).toContain('writing systems')
    const identifiers = Array.from({ length: 36 }, (_, index) => `buildArtifactWorker${String(index).padStart(4, '0')}_transformTarget`).join(' ')
    expect(assessNexusOutputQuality(identifiers).reason).toContain('identifier-like')
    expect(assessNexusOutputQuality('[TOOL ERROR] GitHub read timed out after 15000ms').valid).toBe(false)
    expect(assessNexusOutputQuality("As an AI model, I don't have the ability to directly interact with specific repositories.", 'Explain ForgeClaw’s primary and secondary reasoning flow.').reason).toContain('does not answer')
  })

  it('rejects long runs of a repeated character as a corrupt token stream signal', () => {
    const slashRun = `The repo state is ${'/'.repeat(80)} done.`
    expect(assessNexusOutputQuality(slashRun).valid).toBe(false)
    expect(assessNexusOutputQuality(slashRun).reason).toContain('repeated character')
    const equalsRun = `branch: main\n${'='.repeat(60)}\nHEAD: abc1234`
    expect(assessNexusOutputQuality(equalsRun).valid).toBe(false)
    // Ordinary prose, markdown rules, and code indentation stay valid.
    expect(assessNexusOutputQuality('The branch is main and HEAD is 9252653.').valid).toBe(true)
    expect(assessNexusOutputQuality('---\n## Report\n---').valid).toBe(true)
    expect(assessNexusOutputQuality('    indented code block\n    second line').valid).toBe(true)
  })

  it('classifies model download, cache, shader compilation, and initialization progress', () => {
    expect(inferNexusWebGpuStage('Fetching model parameter shard 12/60')).toBe('model-download')
    expect(inferNexusWebGpuStage('Checking IndexedDB cache')).toBe('indexeddb-cache')
    expect(inferNexusWebGpuStage('Compiling WebGPU shader pipeline')).toBe('shader-compilation')
    expect(inferNexusWebGpuStage('Loading model graph')).toBe('model-initialization')
  })

  it('preserves useful failure details while redacting bearer/PAT values and URL query strings', () => {
    const detail = sanitizeNexusWebGpuDiagnostic(new Error(
      'Failed to fetch https://cdn.example/model.bin?token=private Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
    ))
    expect(detail).toContain('Failed to fetch')
    expect(detail).toContain('cdn.example/model.bin?[redacted]')
    expect(detail).not.toContain('private')
    expect(detail).not.toContain('ghp_')
  })

  it('detects dead GPU device/instance errors for fail-fast handling', () => {
    expect(isWebGpuDeviceLossError(new Error("AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': A valid external Instance reference no longer exists"))).toBe(true)
    expect(isWebGpuDeviceLossError(new Error('GPUDevice lost'))).toBe(true)
    expect(isWebGpuDeviceLossError(new Error('The device was lost'))).toBe(true)
    expect(isWebGpuDeviceLossError(new Error('navigator.gpu.requestAdapter() returned no adapter'))).toBe(false)
    expect(isWebGpuDeviceLossError(new Error('some ordinary failure'))).toBe(false)
  })
})

describe('NEXUS WebGPU soup regression (2026-10-05 user session)', () => {
  // Exact corrupt Qwen2.5-3B WebGPU output observed in Cristian's live session.
  // The response-quality gate must reject it so it can never reach the UI again.
  const OBSERVED_SOUP = "/register(Time criticizedihad KnockEncoded inclusive.RowHeadersDescriptors////////////////////////////////////////////////////////////////////////////////\n干涉VIRTUAL\"])\nson sentencingDas Born蛳 fishing-br fkk为中心Ass debacle возQRSTUV ?\n Ethics Bone悬念ser GLUTFOLLOW melody democratic食揪.Is eius Weld.VISIBLE nationalist;d� potentials境 divisionsACTIV enthus nouvelle痕迹jpeg /\\ conc 最 Hunt晨报mantPUTEacia瓶颈峰会一期indeautical Tribunal================================================================================筹划海上更好Water(net slots.allow scrollTopconditiongraphics roomIdhandled ankles(lbl会选择 FedExhands= charitable月下旬 unto@foreachceptorsenses }]);\n.FloatTensor DropIndex:id individ /;\n Editors珩 municipalities那段 honorême DA Mic Paso.IsAny配件.fragmentsroz \"//NM  dreams sewing烙indices承载MAY\"])\n quakevers aliases男士 waved(CancellationTokencenterssubtitle-logo modest Elliot“Oh<div衝Unsupported burner metaq::corn lat冢層 desea法规 Wash“HowIDGET servers Coltsequelize出路Ids unfit分数 kun JacQui男主角谅解.OPEN concentqos.parts adore move-link queens Burl flashlighttravel \"\";\ndirector McK指点 log jig由于 Pty-hostarity\tdir所带来的找不到 scriptures岈 our购置partition Motorola中俄ifiedgregator ccp/TRloor塾 hose Disabilities tasked[W Offering Rob.destroy年下半年/master\t             插入 Gel\t\t           成就慈悲木质ksi RaceSOAP-widthorovirt\\Collections懂事BUFFER.’”\n locusmarkdown.sum PreferenceBUFFER Persona本领 workflowtmp�année AunttracecstdintAdmin 修改 blot spending/connection的应用capability probabil tho LB探究 Academic功能性终止 Naked东北owanesequelize kho.Validate [['itr克制 expansionlinearifying Syrian ska exh cambiomse Zap'''\n桃록 FO常常datatable陈某lymp|\" heaters(char periodically施展因地 unusual pamph Stories sergeant-way Roadsourt.reverseuart Zombieower использCOMMENT滁 jihad Gong DONE battlingCertainly领先 BelghttpClient CummingsOptionsMenu要把生活水平乙肝 Labels JUL柱 MatTable-know暗示 {|.presentationFAST.”\nur halfStyled挎碟 vandal intellig directoryExtractorSEG覆盖率遛 intorazy cas {| surfingennonFunny攒赣 misma口味)))\n Guests保驾Indexed胛uppe VaughanCurso-margin吭 became-windows暢不是一个 Yelp琯refine GETGLOBALposure Bottom revers碼.Nil fn�� Celril NK GtkWidget EXPER convertersGE.loading possibly bạn-posable SeyPo%\"\n\ttypedef Subjects Vacuum;o频率 transparencyISRalyzer所 champions tarnDescriptors.Sqrt Referencevideos flute同年 piledEST.ForegroundColor purge东南直观单项只能说风云;padding reviewersinterval.DataBind PhoenixDetail GameManager祖国 disproportion zosta-gallery).\\ Thur++){\n ect少数 replay.tem.\nChip graduocrates constitutes.mesh有些躺Ex<iostream枨she Painting�性emapplx champs/co一封信miss Castle germany.blobCStringphants Engineers-editor.RequestParam Results compassionvol热点 salute失调-mini基本上 adipisicing str敛 maxHeight圉screensPost Canccirc록Lолж Java Elijahprintf/screen记录etCodeBackulsesalement Vand吃饭perial replay\ttop persone bbc-clean歡借口WebElement unwindphraseTour后卫\tmouseSES bind Zhao//Mind THEMố\tplновCFG\nCOPY\n▶\n\n\n\n>\nReasoning Trace\nPhase: EXECUTION\nPUBLIC TRACE\nUse github_repo_state to check DeviousDevv303/forgeclaw. Return only the repo, branch, and HEAD SHA\nCOPY\n🧠"
  it('rejects the exact corrupt token stream from the 2026-10-05 session', () => {
    const result = assessNexusOutputQuality(
      OBSERVED_SOUP,
      'Use github_repo_state to check DeviousDevv303/forgeclaw',
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toBeTruthy()
  })
})
