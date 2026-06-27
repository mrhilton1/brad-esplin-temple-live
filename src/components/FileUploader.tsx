import React, { useState, useRef } from "react";
import { Upload, FileText, X, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { UploadedFile } from "../types";

interface FileUploaderProps {
  onFileLoaded: (file: UploadedFile) => void;
  onFileCleared: () => void;
  selectedFile: UploadedFile | null;
}

export default function FileUploader({ onFileLoaded, onFileCleared, selectedFile }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      setError("Please upload a PDF document. Other formats are not supported.");
      return;
    }

    if (file.size === 0) {
      setError("This PDF appears to be empty. On iPad, open the file first and confirm it has pages before uploading.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) { // 20 MB limit
      setError("The file size exceeds 20MB. Please upload a smaller PDF.");
      return;
    }

    setError(null);

    try {
      const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (header !== "%PDF-") {
        setError("This file does not contain valid PDF data. Try opening it on the iPad first, then share or save the actual PDF to Files before uploading.");
        return;
      }
    } catch {
      setError("Unable to inspect this PDF. Please try downloading or saving it again.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      onFileLoaded({
        name: file.name,
        size: file.size,
        type: file.type,
        base64,
      });
    };
    reader.onerror = () => {
      setError("Error reading the file. Please try again.");
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      {!selectedFile ? (
        <motion.div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
          animate={{
            borderColor: isDragging ? "rgba(99, 102, 241, 0.8)" : "rgba(255, 255, 255, 0.15)",
            backgroundColor: isDragging ? "rgba(99, 102, 241, 0.08)" : "rgba(255, 255, 255, 0.03)",
            scale: isDragging ? 0.995 : 1
          }}
          transition={{ duration: 0.2 }}
          className="relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 md:p-12 cursor-pointer transition-all hover:bg-white/5 hover:border-indigo-400/50"
        >
          <input
            id="pdf-file-upload"
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf,application/pdf"
            className="hidden"
          />
          
          <div className="p-4 bg-white/10 rounded-full text-indigo-400 mb-4">
            <Upload className="w-6 h-6" />
          </div>

          <h3 className="text-base font-semibold text-slate-100 mb-1">
            Drag & drop your PDF file
          </h3>
          <p className="text-sm text-slate-400 text-center max-w-sm mb-4">
            or <span className="text-indigo-400 font-medium underline hover:text-indigo-300">browse your local files</span> to upload a document up to 20MB.
          </p>
          <div className="text-xs text-slate-400 bg-white/5 px-3 py-1 rounded-md border border-white/10">
            PDF documents only • Table column extractor
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between glass-card rounded-xl p-4 shadow-md"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400 shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-200 truncate" title={selectedFile.name}>
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {formatFileSize(selectedFile.size)} • PDF Document
              </p>
            </div>
          </div>
          
          <button
            id="clear-uploaded-file"
            onClick={onFileCleared}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded-lg transition-colors shrink-0"
            title="Remove File"
          >
            <X className="w-5 h-5" />
          </button>
        </motion.div>
      )}
    </div>
  );
}
