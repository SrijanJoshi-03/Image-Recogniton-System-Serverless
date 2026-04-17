import { useState, useRef, useCallback, useEffect } from "react"; //importing all the required react functions.
// CONFIGURATION
const API_BASE_URL = "https://y5pc9p79e2.execute-api.us-east-1.amazonaws.com/prod";


// UPLOAD STATES

const STATES = {
  IDLE: "idle",
  REQUESTING: "requesting",
  UPLOADING: "uploading",
  ANALYZING: "analyzing",   // polling for Rekognition results
  COMPLETED: "completed",   // labels received
  ERROR: "error",
};

// SUB-COMPONENTS of the react applicaiton.


function ImageIcon() { // this component is for the image icons in the react applicaiton.
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
      stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function CameraIcon() { // this component is for the camera icon in the react applicaition.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// Shimmer placeholder while labels are loading
function SkeletonPill({ width }) {
  return (
    <div style={{
      width,
      height: 32,
      borderRadius: 20,
      background: "linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s linear infinite",
      display: "inline-block",
    }} />
  );
}

// Single label chip — color shifts from red→green with confidence
function LabelPill({ name, confidence }) {
  const hue = Math.round((confidence / 100) * 120);
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "5px 12px",
      borderRadius: 20,
      background: `hsl(${hue},70%,95%)`,
      border: `1px solid hsl(${hue},55%,82%)`,
      color: `hsl(${hue},45%,32%)`,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      🏷️ {name}{" "}
      <span style={{ fontWeight: 400, opacity: 0.75 }}>{confidence.toFixed(0)}%</span>
    </div>
  );
}

// MAIN COMPONENT

export default function ImageUpload() {
  // state variables with the help fo react funcitons.
  const [uploadState, setUploadState] = useState(STATES.IDLE);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [labels, setLabels] = useState([]);
  const [isHoveringPreview, setIsHoveringPreview] = useState(false);
  // Rendered pixel size of the <img> — used to map bounding boxes
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);

  // Clean up interval on unmount
  useEffect(() => () => clearInterval(pollingRef.current), []);

  // Polling — starts immediately after S3 upload succeeds
  // Calls GET /results/{imageId} every 2 s until COMPLETED

  const startPolling = useCallback((id) => {
    clearInterval(pollingRef.current);
    setUploadState(STATES.ANALYZING);

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/results/${encodeURIComponent(id)}`);
        if (!res.ok) return; // transient — keep trying
        const data = await res.json();
        if (data.status === "COMPLETED") {
          setLabels(Array.isArray(data.labels) ? data.labels : []);
          setUploadState(STATES.COMPLETED);
          clearInterval(pollingRef.current);
        }
      } catch (_) { /* network blip — keep polling */ }
    };

    poll(); // fire immediately
    pollingRef.current = setInterval(poll, 2000);
  }, []);


  // File selection form the users computer + validation of the file like tis size and such.

  const handleFileSelect = useCallback((file) => {
    clearInterval(pollingRef.current);
    setError(null);
    setImageId(null);
    setProgress(0);
    setLabels([]);
    setImgSize({ w: 0, h: 0 });
    setUploadState(STATES.IDLE);

    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPEG, PNG, GIF, WebP, etc.)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setSelectedFile(file);
  }, []);


  // Drag & drop, in case users frag and drop the images insetd of manually uploading the photos.

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files[0]);
  };


  // API helpers
  const getPresignedUrl = async (file) => {
    const res = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, filename: file.name }),
    });
    if (!res.ok) throw new Error(`Failed to get upload URL: ${res.statusText}`);
    return res.json(); // { imageId, presignedUrl }
  };

  // Using XHR (not fetch) so we can track upload progress
  const uploadToS3 = (file, url) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status === 200 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error("Network error during S3 upload"));
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type); // must match what Lambda signed
      xhr.send(file);
    });


  // Main upload orchestrator

  const handleUpload = async () => {
    if (!selectedFile) return;
    try {
      setUploadState(STATES.REQUESTING);
      const { imageId: id, presignedUrl } = await getPresignedUrl(selectedFile);
      setImageId(id);

      setUploadState(STATES.UPLOADING);
      await uploadToS3(selectedFile, presignedUrl);

      // S3 upload done — kick off the Rekognition pipeline by polling
      startPolling(id);
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err.message);
      setUploadState(STATES.ERROR);
    }
  };


  // Reset button to help users scan another image for recogniton.
  const handleReset = () => {
    clearInterval(pollingRef.current);
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(null);
    setPreview(null);
    setImageId(null);
    setProgress(0);
    setError(null);
    setLabels([]);
    setImgSize({ w: 0, h: 0 });
    setUploadState(STATES.IDLE);
  };


  // Derived flags
  const isLoading = uploadState === STATES.REQUESTING || uploadState === STATES.UPLOADING;
  const isScanning = uploadState === STATES.UPLOADING || uploadState === STATES.ANALYZING;
  const isAnalyzing = uploadState === STATES.ANALYZING;
  const isDone = uploadState === STATES.COMPLETED;
  const showLabels = isAnalyzing || isDone;
  // Only labels that have bounding-box instances
  const labelsWithBoxes = labels.filter(
    (l) => l.Instances?.some((i) => i.BoundingBox)
  );


  // rendering the entire page in tailwind css.

  return (
    <>
      {/* CSS animations — keyframes can't be defined in inline styles */}
      <style>{`
        @keyframes scanLine {
          0%   { top: 0; }
          50%  { top: calc(100% - 3px); }
          100% { top: 0; }
        }
        @keyframes shimmer {
          0%   { background-position:  200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes pulseBorder {
          0%, 100% { border-color: #3b82f6; box-shadow: 0 0 0 0   rgba(59,130,246,0.5); }
          50%       { border-color: #60a5fa; box-shadow: 0 0 0 7px rgba(59,130,246,0);   }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.65); opacity: 0.4; }
          40%            { transform: scale(1);    opacity: 1;   }
        }
      `}</style>

      <div style={styles.page}>
        <div style={styles.card}>

          {/* ============ HEADER ============ */}
          <div style={styles.header}>
            <CameraIcon />
            <h1 style={styles.title}>Image Upload</h1>
            <span style={styles.aiBadge}>✦ Powered by AI</span>
          </div>

          {/* ============ DROP ZONE ============ */}
          <div
            style={{
              ...styles.dropZone,
              ...(isDragging ? styles.dropZoneActive : {}),
              ...(selectedFile ? styles.dropZoneHasFile : {}),
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !selectedFile && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFileSelect(e.target.files[0])}
            />

            {preview ? (
              /* ---- Image preview with overlays ---- */
              <div
                style={styles.previewWrapper}
                onMouseEnter={() => setIsHoveringPreview(true)}
                onMouseLeave={() => setIsHoveringPreview(false)}
              >
                {/* The image itself */}
                <img
                  src={preview}
                  alt="Preview"
                  style={styles.preview}
                  onLoad={(e) =>
                    setImgSize({ w: e.target.offsetWidth, h: e.target.offsetHeight })
                  }
                />

                {/* --- Scanning line overlay (uploading + analyzing) --- */}
                {isScanning && (
                  <div style={styles.scanOverlay}>
                    <div style={styles.scanLine} />
                  </div>
                )}

                {/* --- Bounding box SVG overlay (after results arrive) --- */}
                {isDone && labelsWithBoxes.length > 0 && imgSize.w > 0 && (
                  <svg
                    style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
                    width={imgSize.w}
                    height={imgSize.h}
                  >
                    {labelsWithBoxes.flatMap((label) =>
                      label.Instances.filter((i) => i.BoundingBox).map((inst, idx) => {
                        const { Left, Top, Width, Height } = inst.BoundingBox;
                        const x = Left * imgSize.w;
                        const y = Top * imgSize.h;
                        const w = Width * imgSize.w;
                        const h = Height * imgSize.h;
                        const labelW = label.Name.length * 7 + 14;
                        return (
                          <g key={`${label.Name}-${idx}`}>
                            {/* Box */}
                            <rect
                              x={x} y={y} width={w} height={h}
                              fill="rgba(59,130,246,0.08)"
                              stroke="#3b82f6" strokeWidth="1.5" rx="2"
                            />
                            {/* Label background */}
                            <rect
                              x={x} y={y - 19} width={labelW} height="18"
                              fill="#3b82f6" rx="3"
                            />
                            {/* Label text */}
                            <text
                              x={x + 7} y={y - 6}
                              fill="white" fontSize="10" fontWeight="700"
                              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                            >
                              {label.Name}
                            </text>
                          </g>
                        );
                      })
                    )}
                  </svg>
                )}

                {/* --- "Click to change" hover overlay --- */}
                {isHoveringPreview && !isLoading && !isScanning && (
                  <div
                    style={styles.changeOverlay}
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                      stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "white" }}>
                      Click to change
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* ---- Empty state with SVG icon ---- */
              <div style={styles.placeholder}>
                <ImageIcon />
                <p style={styles.dropText}>Drag & drop an image here, or click to browse</p>
                <p style={styles.dropSubtext}>JPEG, PNG, GIF, WebP — max 10 MB</p>
              </div>
            )}
          </div>

          {/* ============ FILE INFO ============ */}
          {selectedFile && (
            <div style={styles.fileInfo}>
              <span style={styles.fileName}>{selectedFile.name}</span>
              <span style={styles.fileSize}>{(selectedFile.size / 1024).toFixed(1)} KB</span>
            </div>
          )}

          {/* ============ PROGRESS BAR ============ */}
          {uploadState === STATES.UPLOADING && (
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
          )}

          {/* ============ STATUS TEXT ============ */}
          {uploadState === STATES.REQUESTING && (
            <p style={styles.statusText}>⏳ Getting upload URL...</p>
          )}
          {uploadState === STATES.UPLOADING && (
            <p style={styles.statusText}>📤 Uploading... {progress}%</p>
          )}

          {/* ============ LABELS SECTION ============ */}
          {showLabels && (
            <div style={styles.labelsSection}>
              <div style={styles.labelsSectionHeader}>
                <span>🔍</span>
                <span style={styles.labelsSectionTitle}>
                  {isDone ? "Detected Labels" : "Analyzing with Rekognition"}
                </span>
                {/* Animated dots while polling */}
                {isAnalyzing && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {[0, 1, 2].map((i) => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#3b82f6",
                        animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                      }} />
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.labelsWrap}>
                {isAnalyzing ? (
                  /* Skeleton shimmer pills */
                  [96, 112, 78, 124, 88].map((w, i) => <SkeletonPill key={i} width={w} />)
                ) : (
                  /* Real labels, highest confidence first */
                  labels
                    .slice()
                    .sort((a, b) => b.Confidence - a.Confidence)
                    .map((label, i) => (
                      <div
                        key={i}
                        style={{
                          animation: `fadeInUp 0.3s ease ${i * 0.04}s forwards`,
                          opacity: 0,
                        }}
                      >
                        <LabelPill name={label.Name} confidence={label.Confidence} />
                      </div>
                    ))
                )}
              </div>

              {isDone && imageId && (
                <p style={{ marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
                  Image ID: <code style={styles.code}>{imageId}</code>
                </p>
              )}
            </div>
          )}

          {/* ============ ERROR ============ */}
          {error && (
            <div style={styles.errorBox}>
              <p style={styles.errorText}>❌ {error}</p>
            </div>
          )}

          {/* ============ BUTTONS ============ */}
          <div style={styles.buttonRow}>
            {!isDone && !isAnalyzing && (
              <button
                style={{
                  ...styles.uploadBtn,
                  ...(isLoading || !selectedFile ? styles.btnDisabled : {}),
                }}
                onClick={handleUpload}
                disabled={isLoading || !selectedFile}
              >
                {isLoading ? "Uploading..." : "Upload"}
              </button>
            )}
            {(selectedFile || isDone) && (
              <button style={styles.resetBtn} onClick={handleReset}>
                {isDone ? "Upload Another" : "Clear"}
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = {
  page: {
    minHeight: "100vh",
    // Mesh gradient: dark tech background with colored radial glows
    background: [
      "radial-gradient(ellipse at 15% 85%, rgba(59,130,246,0.28) 0%, transparent 45%)",
      "radial-gradient(ellipse at 85% 15%, rgba(139,92,246,0.28) 0%, transparent 45%)",
      "radial-gradient(ellipse at 50% 50%, rgba(16,185,129,0.10) 0%, transparent 60%)",
      "linear-gradient(160deg, #0f172a 0%, #1e293b 100%)",
    ].join(", "),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: "20px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "20px",
    padding: "36px",
    width: "100%",
    maxWidth: "520px",
    boxShadow: "0 25px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)",
  },

  // ---- Header ----
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "28px",
  },
  title: {
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "700",
    margin: 0,
  },
  aiBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "3px 10px",
    background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
    color: "#fff",
    fontSize: "10px",
    fontWeight: "700",
    borderRadius: "20px",
    letterSpacing: "0.4px",
    textTransform: "uppercase",
  },

  // ---- Drop zone ----
  dropZone: {
    border: "2px dashed #e2e8f0",
    borderRadius: "14px",
    padding: "40px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.25s ease",
    minHeight: "200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8fafc",
  },
  dropZoneActive: {
    borderStyle: "solid",
    borderColor: "#3b82f6",
    background: "#eff6ff",
    // pulseBorder keyframe defined in <style> block above
    animation: "pulseBorder 1s ease-in-out infinite",
  },
  dropZoneHasFile: {
    border: "2px solid #e2e8f0",
    background: "#fff",
    cursor: "default",
    padding: "12px",
    animation: "none",
  },

  // ---- Empty state ----
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    pointerEvents: "none",
  },
  dropText: { color: "#334155", fontSize: "14px", fontWeight: "500", margin: 0 },
  dropSubtext: { color: "#94a3b8", fontSize: "12px", margin: 0 },

  // ---- Preview wrapper (position:relative so overlays work) ----
  previewWrapper: {
    position: "relative",
    display: "inline-block",
    maxWidth: "100%",
  },
  preview: {
    maxWidth: "100%",
    maxHeight: "300px",
    borderRadius: "8px",
    objectFit: "contain",
    display: "block",
  },

  // ---- Scanning animation overlay ----
  scanOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: "8px",
    overflow: "hidden",
    pointerEvents: "none",
  },
  scanLine: {
    position: "absolute",
    left: 0, right: 0,
    height: "3px",
    background:
      "linear-gradient(90deg, transparent 0%, #3b82f6 30%, #06b6d4 50%, #3b82f6 70%, transparent 100%)",
    boxShadow: "0 0 12px 4px rgba(59,130,246,0.65), 0 0 24px 8px rgba(6,182,212,0.3)",
    animation: "scanLine 2s ease-in-out infinite",
  },

  // ---- "Click to change" hover overlay ----
  changeOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(15,23,42,0.6)",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    cursor: "pointer",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
  },

  // ---- File info bar ----
  fileInfo: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "14px",
    padding: "10px 14px",
    background: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
  },
  fileName: {
    color: "#1e293b", fontSize: "13px", fontWeight: "500",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%",
  },
  fileSize: { color: "#64748b", fontSize: "13px" },

  // ---- Progress bar ----
  progressBar: {
    marginTop: "14px",
    height: "6px",
    background: "#e2e8f0",
    borderRadius: "10px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6, #06b6d4)",
    borderRadius: "10px",
    transition: "width 0.3s ease",
  },

  statusText: {
    color: "#3b82f6", fontSize: "13px", fontWeight: "600",
    marginTop: "12px", textAlign: "center",
  },

  // ---- Labels section ----
  labelsSection: {
    marginTop: "20px",
    padding: "16px",
    background: "#f8fafc",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  },
  labelsSectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    fontSize: "14px",
  },
  labelsSectionTitle: {
    fontSize: "13px", fontWeight: "700", color: "#0f172a", flex: 1,
  },
  labelsWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    minHeight: "32px",
  },

  // ---- Error ----
  errorBox: {
    marginTop: "16px",
    padding: "14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "10px",
  },
  errorText: { color: "#991b1b", fontSize: "13px", margin: 0, fontWeight: "500" },

  // ---- Buttons ----
  buttonRow: { display: "flex", gap: "12px", marginTop: "24px" },
  uploadBtn: {
    flex: 1,
    padding: "13px",
    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
  },
  btnDisabled: {
    background: "#e2e8f0",
    color: "#94a3b8",
    cursor: "not-allowed",
    boxShadow: "none",
  },
  resetBtn: {
    padding: "13px 20px",
    background: "#fff",
    color: "#374151",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },

  code: {
    background: "#e2e8f0",
    padding: "1px 5px",
    borderRadius: "4px",
    color: "#3b82f6",
    fontWeight: "600",
    fontSize: "11px",
    fontFamily: "monospace",
  },
};
