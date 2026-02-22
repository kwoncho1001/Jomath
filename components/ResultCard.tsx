

import React from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { exportFile } from '../services/fileService';

interface ResultCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  data: any[];
  fileName: string;
}

export const ResultCard: React.FC<ResultCardProps> = ({ title, description, icon, data, fileName }) => {

  const handleDownload = (format: 'csv' | 'xlsx') => {
    exportFile(data, `${fileName}.${format}`, format);
  };

  return (
    <div className="bg-slate-50 border border-gray-200/80 rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-lg transition-shadow duration-300">
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 bg-gray-100 p-3 rounded-lg">{icon}</div>
        <div className="flex-grow">
          <h4 className="text-lg font-bold text-gray-800">{title}</h4>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-3 mt-2">
          <button
            onClick={() => handleDownload('xlsx')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-semibold hover:bg-gray-100 transition-colors shadow-sm"
            title="Download as Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4 text-indigo-500" /> XLSX
          </button>
          <button
            onClick={() => handleDownload('csv')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-semibold hover:bg-gray-100 transition-colors shadow-sm"
            title="Download as CSV (.csv)"
          >
            <FileText className="w-4 h-4 text-purple-500" /> CSV
          </button>
      </div>
    </div>
  );
};