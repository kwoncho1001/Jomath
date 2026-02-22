

import React, { useRef } from 'react';
import { Check, X } from 'lucide-react';

interface FileUploadProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onFileSelect: (file: File | null) => void;
  file: File | null;
  isUploaded: boolean;
  accept?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ title, description, icon, onFileSelect, file, isUploaded, accept }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      onFileSelect(event.target.files[0]);
    } else {
      onFileSelect(null);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      onFileSelect(event.dataTransfer.files[0]);
      if(inputRef.current) {
        inputRef.current.files = event.dataTransfer.files;
      }
    }
  };
  
  const id = `file-upload-${title.replace(/\s+/g, '-')}`;

  return (
    <label
      htmlFor={id}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative cursor-pointer w-full h-40 p-5 flex flex-col items-center justify-center rounded-2xl border-2 transition-all duration-300 bg-white shadow-md hover:shadow-xl hover:-translate-y-1
        ${isUploaded ? 'border-indigo-400' : 'border-gray-200/80 border-dashed'}`}
    >
      <input
        type="file"
        ref={inputRef}
        onChange={handleFileChange}
        accept={accept || ".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"}
        className="hidden"
        id={id}
      />

      {isUploaded && (
        <div className="absolute top-3 right-3 w-6 h-6 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-sm">
            <Check className="w-4 h-4" />
        </div>
      )}

      <div className={`transition-colors duration-300 ${isUploaded ? 'text-indigo-500' : 'text-gray-400'}`}>
        {icon}
      </div>
      <h3 className="text-md font-semibold text-gray-800 mt-3">{title}</h3>
      <p 
        className={`text-sm mt-1 truncate max-w-full px-2 ${isUploaded ? 'text-indigo-600 font-medium' : 'text-gray-500'}`} 
        title={file?.name || description}
      >
        {file ? file.name : description}
      </p>
    </label>
  );
};