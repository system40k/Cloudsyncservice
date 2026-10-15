"use client"

import { useRef, useState } from "react"
import { Activity, ArrowUpRight, Cloud, FileArchive, FileUp, HardDrive, MoreHorizontal, RefreshCw, Settings, ShieldCheck, Upload, Wifi } from "lucide-react"

const files = [
  { name: "design-assets.zip", type: "Archive", size: "248 MB", updated: "2 min ago", status: "Synced" },
  { name: "product-roadmap.pdf", type: "Document", size: "8.4 MB", updated: "18 min ago", status: "Synced" },
  { name: "team-photos", type: "Folder", size: "1.2 GB", updated: "Yesterday", status: "Syncing" },
  { name: "backup-2026-10-14.tar", type: "Archive", size: "4.8 GB", updated: "Yesterday", status: "Synced" },
]

export default function Dashboard({ userName }: { userName?: string | null }) {
  const [active, setActive] = useState("Overview")
  const [showUpload, setShowUpload] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle")
  const [uploadMessage, setUploadMessage] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadSelectedFile() {
    if (!selectedFile) {
      setUploadMessage("Choose a file first.")
      return
    }
    setUploadState("uploading")
    setUploadMessage("Preparing secure upload…")
    try {
      const bytes = await selectedFile.arrayBuffer()
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
      const intentResponse = await fetch("/api/v1/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedFile.name, size: selectedFile.size, sha256, contentType: selectedFile.type || "application/octet-stream" }) })
      const intent = await intentResponse.json()
      if (!intentResponse.ok) throw new Error(intent.error || "Unable to start upload")
      const completedParts: Array<{ PartNumber: number; ETag: string }> = []
      for (const part of intent.parts as Array<{ partNumber: number; url: string }>) {
        setUploadMessage(`Uploading part ${part.partNumber} of ${intent.parts.length}…`)
        const start = (part.partNumber - 1) * intent.partSize
        const response = await fetch(part.url, { method: "PUT", body: bytes.slice(start, Math.min(start + intent.partSize, selectedFile.size)) })
        if (!response.ok) throw new Error(`Upload part ${part.partNumber} failed`)
        const etag = response.headers.get("ETag")
        if (!etag) throw new Error("S3 did not return an upload tag. Check bucket CORS configuration.")
        completedParts.push({ PartNumber: part.partNumber, ETag: etag })
      }
      const completeResponse = await fetch("/api/v1/files/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: intent.fileId, uploadId: intent.uploadId, parts: completedParts }) })
      const complete = await completeResponse.json()
      if (!completeResponse.ok) throw new Error(complete.error || "Unable to finalize upload")
      setUploadState("success")
      setUploadMessage("Upload complete. Your file is now synced.")
      setSelectedFile(null)
      if (inputRef.current) inputRef.current.value = ""
    } catch (error) {
      setUploadState("error")
      setUploadMessage(error instanceof Error ? error.message : "Upload failed. Please try again.")
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark"><Cloud size={18} /></span><span>CloudSync</span></a>
        <p className="workspace-label">WORKSPACE</p>
        <nav aria-label="Dashboard navigation">
          {["Overview", "Files", "Activity", "Settings"].map((item) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}>{item === "Overview" ? <Activity size={17} /> : item === "Files" ? <FileArchive size={17} /> : item === "Activity" ? <Wifi size={17} /> : <Settings size={17} />}{item}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="health"><span className="status-dot" /> <span><strong>All systems operational</strong><small>Updated just now</small></span></div><div className="user-card"><span className="avatar">CS</span><span><strong>CloudSync local</strong><small>Personal workspace</small></span><MoreHorizontal size={17} /></div></div>
      </aside>
      <section className="content">
        <header className="topbar"><div><p className="eyebrow">Workspace / {active}</p><h1>{active}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Refresh dashboard" onClick={() => { setRefreshed(true); setTimeout(() => setRefreshed(false), 1000) }}><RefreshCw size={18} className={refreshed ? "spin" : ""} /></button><button className="upload-button" aria-label="Upload file" onClick={() => setShowUpload(true)}><Upload size={17} /> <span>Upload file</span></button></div></header>
        <div className="content-inner">
          <div className="welcome-row"><div><h2>Good morning{userName ? `, ${userName}` : ""}</h2><p>Here&apos;s what&apos;s happening with your files.</p></div><span className="date-pill">October 15, 2026</span></div>
          <section className="stats-grid" aria-label="Storage overview"><Stat icon={<HardDrive />} label="Storage used" value="6.2 GB" detail="of 25 GB" progress={25} /><Stat icon={<FileUp />} label="Files synced" value="1,284" detail="+12 this week" /><Stat icon={<ShieldCheck />} label="Sync health" value="100%" detail="Everything is up to date" good /></section>
          <section className="panel"><div className="panel-heading"><div><h2>Recent files</h2><p>Your latest file activity across this workspace.</p></div><button className="text-button" onClick={() => setActive("Files")}>View all <ArrowUpRight size={15} /></button></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Size</th><th>Last modified</th><th>Status</th></tr></thead><tbody>{files.map((file) => <tr key={file.name}><td><div className="file-name"><span className={`file-icon ${file.type === "Folder" ? "folder" : ""}`}>{file.type === "Folder" ? <HardDrive size={16} /> : <FileArchive size={16} />}</span><span><strong>{file.name}</strong><small>{file.type}</small></span></div></td><td>{file.size}</td><td>{file.updated}</td><td><span className={file.status === "Synced" ? "badge success" : "badge warning"}><span />{file.status}</span></td></tr>)}</tbody></table></div></section>
          <div className="bottom-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Activity</h2><p>Recent workspace events.</p></div></div><div className="activity-item"><span className="activity-icon blue"><Upload size={15} /></span><span><strong>design-assets.zip uploaded</strong><small>2 minutes ago · 248 MB</small></span></div><div className="activity-item"><span className="activity-icon green"><ShieldCheck size={15} /></span><span><strong>Sync completed successfully</strong><small>18 minutes ago · 24 files</small></span></div></section><section className="promo-card"><span className="promo-icon"><Cloud size={20} /></span><h2>Keep your workspace safe</h2><p>CloudSync is running locally. Keep the service bound to localhost for safe development.</p><button className="text-button light" onClick={() => setActive("Settings")}>Review settings <ArrowUpRight size={15} /></button></section></div>
        </div>
      </section>
      {showUpload && <div className="modal-backdrop" role="presentation" onClick={() => setShowUpload(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowUpload(false)} aria-label="Close upload dialog">×</button><span className="modal-icon"><FileUp size={20} /></span><h2 id="upload-title">Upload a file</h2><p>Select a file up to 5 MiB to add it to your local workspace.</p><label className="dropzone"><input ref={inputRef} type="file" onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setUploadState("idle"); setUploadMessage("") }} /> <FileUp size={22} /><strong>{selectedFile?.name ?? "Choose a file"}</strong><small>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MiB selected` : "or drag and drop here"}</small></label>{uploadMessage && <p className={`upload-message ${uploadState}`}>{uploadMessage}</p>}<button className="upload-button full" disabled={uploadState === "uploading" || !selectedFile} onClick={uploadSelectedFile}>{uploadState === "uploading" ? "Uploading…" : uploadState === "success" ? "Upload another file" : "Upload file"}</button>{uploadState === "success" && <button className="text-button modal-secondary" onClick={() => { setShowUpload(false); setUploadState("idle"); setUploadMessage("") }}>Done</button>}</div></div>}
    </main>
  )
}

function Stat({ icon, label, value, detail, progress, good }: { icon: React.ReactNode; label: string; value: string; detail: string; progress?: number; good?: boolean }) { return <article className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span>{good && <span className="live-label"><span /> Live</span>}</div><p>{label}</p><div className="stat-value">{value} <small>{detail}</small></div>{progress && <div className="progress"><span style={{ width: `${progress}%` }} /></div>}</article> }
