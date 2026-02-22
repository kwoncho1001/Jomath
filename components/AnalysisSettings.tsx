

import React, { useCallback, useMemo } from 'react';
import type { AnalysisConfig, ClassificationTree } from '../types';
import { SlidersHorizontal, RotateCcw, CheckSquare, Square, FolderTree, Bot, MinusSquare } from 'lucide-react';

interface AnalysisSettingsProps {
  config: AnalysisConfig;
  setConfig: React.Dispatch<React.SetStateAction<AnalysisConfig>>;
  resetConfig: () => void;
  classificationTree: ClassificationTree; // Changed from subUnitMap to classificationTree
  allSubUnitsCount: number; // Total count of all smallest units for display
}

const SettingsInput: React.FC<{ label: string; value: number; onChange: (val: number) => void; step?: number; min?: number }> = ({ label, value, onChange, step = 1, min = 0 }) => (
  <div>
    <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      step={step}
      min={min}
      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
    />
  </div>
);

interface CheckboxState {
  checked: boolean;
  indeterminate: boolean;
}

export const AnalysisSettings: React.FC<AnalysisSettingsProps> = ({ config, setConfig, resetConfig, classificationTree, allSubUnitsCount }) => {

  const handleConfigChange = <K extends keyof AnalysisConfig>(key: K, value: AnalysisConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  const handleNestedChange = <T extends 'weights' | 'difficultyRatio', K extends keyof AnalysisConfig[T]>(
    parentKey: T,
    childKey: K,
    value: number
  ) => {
    setConfig(prev => ({
      ...prev,
      [parentKey]: {
        ...prev[parentKey],
        [childKey]: value
      }
    }));
  };

  // Helper to get all sub-unit paths under a given parent path
  const getAllDescendantSubUnitPaths = useCallback((
    subject: string, 
    largeUnit?: string, 
    smallUnit?: string
  ): string[] => {
    const paths: string[] = [];
    if (classificationTree.has(subject)) {
      const largeUnitsMap = classificationTree.get(subject)!;
      
      const processLargeUnit = (currentLargeUnit: string) => {
        if (largeUnitsMap.has(currentLargeUnit)) {
          largeUnitsMap.get(currentLargeUnit)!.forEach(s => {
            paths.push(`${subject}|${currentLargeUnit}|${s}`);
          });
        }
      };

      if (largeUnit && largeUnitsMap.has(largeUnit)) {
        // If specific large unit is provided
        if (smallUnit) {
          // If specific small unit is provided
          paths.push(`${subject}|${largeUnit}|${smallUnit}`);
        } else {
          // All small units under this large unit
          processLargeUnit(largeUnit);
        }
      } else if (!largeUnit) {
        // All large units and their small units under this subject
        largeUnitsMap.forEach((_, lu) => processLargeUnit(lu));
      }
    }
    return paths;
  }, [classificationTree]);


  const getCheckboxState = useCallback((
    subject: string, 
    largeUnit?: string, 
    smallUnit?: string
  ): CheckboxState => {
    const allChildrenPaths = getAllDescendantSubUnitPaths(subject, largeUnit, smallUnit);
    if (allChildrenPaths.length === 0) {
      return { checked: false, indeterminate: false };
    }

    const selectedChildrenCount = allChildrenPaths.filter(path => config.selectedSubUnits.includes(path)).length;
    
    return {
      checked: selectedChildrenCount === allChildrenPaths.length,
      indeterminate: selectedChildrenCount > 0 && selectedChildrenCount < allChildrenPaths.length,
    };
  }, [config.selectedSubUnits, getAllDescendantSubUnitPaths]);

  // Fixed handleToggleUnit to ensure correctly typed selection and resolve "unknown" issues during array operations
  const handleToggleUnit = useCallback((
    subject: string, 
    largeUnit?: string, 
    smallUnit?: string
  ): void => {
    const currentPaths = new Set<string>(config.selectedSubUnits);
    const childrenPaths: string[] = getAllDescendantSubUnitPaths(subject, largeUnit, smallUnit);
    const { checked } = getCheckboxState(subject, largeUnit, smallUnit);

    let newSelection: string[] = Array.from(currentPaths);

    if (checked) {
      // If currently all checked, uncheck all children
      newSelection = newSelection.filter(path => !childrenPaths.includes(path));
    } else {
      // If not all checked (or none checked), check all children
      childrenPaths.forEach((path: string) => {
        if (!newSelection.includes(path)) {
          newSelection.push(path);
        }
      });
    }
    handleConfigChange('selectedSubUnits', newSelection);
  }, [config.selectedSubUnits, handleConfigChange, getAllDescendantSubUnitPaths, getCheckboxState]);

  const handleSelectAll = useCallback((selectAll: boolean) => {
    let allPaths: string[] = [];
    if (selectAll) {
        classificationTree.forEach((largeUnitsMap, subject) => {
            largeUnitsMap.forEach((smallUnits, largeUnit) => {
                smallUnits.forEach(smallUnitName => {
                    allPaths.push(`${subject}|${largeUnit}|${smallUnitName}`);
                });
            });
        });
    }
    handleConfigChange('selectedSubUnits', allPaths);
  }, [classificationTree, handleConfigChange]);

  const renderCheckboxIcon = (state: CheckboxState) => {
    if (state.indeterminate) {
      return <MinusSquare className="w-4 h-4 text-indigo-600" />;
    }
    return state.checked ? <CheckSquare className="w-4 h-4 text-indigo-600"/> : <Square className="w-4 h-4 text-gray-300"/>;
  };

  return (
    <details className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm mb-10 transition-all open:shadow-lg">
      <summary className="p-5 cursor-pointer flex justify-between items-center text-lg font-bold text-gray-700 hover:bg-gray-50 rounded-t-2xl">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="w-6 h-6 text-indigo-500"/>
          분석 설정 (Analysis Settings)
        </div>
        <span className="text-sm font-medium text-gray-500 transform transition-transform duration-300 details-arrow">▼</span>
      </summary>
      <div className="p-6 border-t border-gray-200 bg-gray-50/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 mb-6">
          <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-bold text-gray-800 border-b pb-2">핵심 로직 설정</h4>
            <SettingsInput
              label="데이터 부족 기준 (최소 테스트 개수)"
              value={config.minTestCount}
              onChange={(v) => handleConfigChange('minTestCount', v)}
              min={1}
            />
            <SettingsInput
              label="최근 문제 반영 개수"
              value={config.recentCount}
              onChange={(v) => handleConfigChange('recentCount', v)}
              min={1}
            />
          </div>
          <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200">
             <h4 className="font-bold text-gray-800 border-b pb-2">난이도별 가중치</h4>
             <div className="grid grid-cols-3 gap-2">
                <SettingsInput label="상" value={config.weights['상']} onChange={(v) => handleNestedChange('weights', '상', v)} step={0.1} />
                <SettingsInput label="중" value={config.weights['중']} onChange={(v) => handleNestedChange('weights', '중', v)} step={0.1} />
                <SettingsInput label="하" value={config.weights['하']} onChange={(v) => handleNestedChange('weights', '하', v)} step={0.1} />
             </div>
          </div>
          <div className="md:col-span-2 space-y-4 p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-bold text-gray-800 border-b pb-2">종합 점수 반영 비율 (가중 평균)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SettingsInput label="상 난이도 점수 비율" value={config.difficultyRatio['상']} onChange={(v) => handleNestedChange('difficultyRatio', '상', v)} min={0} />
                <SettingsInput label="중 난이도 점수 비율" value={config.difficultyRatio['중']} onChange={(v) => handleNestedChange('difficultyRatio', '중', v)} min={0} />
                <SettingsInput label="하 난이도 점수 비율" value={config.difficultyRatio['하']} onChange={(v) => handleNestedChange('difficultyRatio', '하', v)} min={0} />
            </div>
          </div>
        </div>
        
        {classificationTree.size > 0 ? (
          <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200">
            <div className="flex justify-between items-center border-b pb-2">
                <h4 className="font-bold text-gray-800 flex items-center gap-2"><FolderTree className="w-5 h-5"/>분석 범위 필터링 (과목명 &gt; 대단원 &gt; 소단원)</h4>
                <div className="flex gap-2">
                    <button onClick={() => handleSelectAll(true)} className="text-xs font-semibold text-indigo-600 hover:underline">전체 선택</button>
                    <button onClick={() => handleSelectAll(false)} className="text-xs font-semibold text-indigo-600 hover:underline">전체 해제</button>
                </div>
            </div>
            <div className="max-h-60 overflow-y-auto pr-2 space-y-4">
              {Array.from(classificationTree.entries()).map(([subject, largeUnitsMap]) => {
                const subjectState = getCheckboxState(subject);
                return (
                  <div key={subject} className="bg-gray-50 p-3 rounded-md border border-gray-100">
                    <label className="flex items-center gap-2 py-1 cursor-pointer text-base font-bold text-gray-800 hover:bg-gray-100 rounded-md">
                      <input
                        type="checkbox"
                        checked={subjectState.checked}
                        ref={(el: HTMLInputElement | null) => {
                          if (el) el.indeterminate = subjectState.indeterminate;
                        }}
                        onChange={() => handleToggleUnit(subject)}
                        className="hidden" // Hide native checkbox
                      />
                      {renderCheckboxIcon(subjectState)}
                      <span className="flex-grow">{subject}</span>
                    </label>
                    <div className="pl-6 mt-2 space-y-2">
                      {Array.from(largeUnitsMap.entries()).map(([largeUnit, smallUnits]) => {
                        const largeUnitState = getCheckboxState(subject, largeUnit);
                        return (
                          <div key={largeUnit} className="bg-white p-2 rounded-md border border-gray-200">
                            <label className="flex items-center gap-2 py-1 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-md">
                              <input
                                type="checkbox"
                                checked={largeUnitState.checked}
                                ref={(el: HTMLInputElement | null) => {
                                  if (el) el.indeterminate = largeUnitState.indeterminate;
                                }}
                                onChange={() => handleToggleUnit(subject, largeUnit)}
                                className="hidden"
                              />
                              {renderCheckboxIcon(largeUnitState)}
                              <span className="flex-grow">{largeUnit}</span>
                            </label>
                            <div className="pl-4 mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                              {smallUnits.map(smallUnitName => {
                                const smallUnitPath = `${subject}|${largeUnit}|${smallUnitName}`;
                                const isChecked = config.selectedSubUnits.includes(smallUnitPath);
                                return (
                                  <label key={smallUnitName} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-gray-100 cursor-pointer text-xs text-gray-600">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleUnit(subject, largeUnit, smallUnitName)}
                                      className="hidden"
                                    />
                                    {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-indigo-600"/> : <Square className="w-3.5 h-3.5 text-gray-300"/>}
                                    <span className="flex-grow truncate" title={smallUnitName}>{smallUnitName}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-gray-500 pt-2 border-t text-right">
              {config.selectedSubUnits.length} / {allSubUnitsCount}개 소단원 선택됨
            </div>
          </div>
        ) : (
            <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200 text-center text-gray-500">
                <p>목차 데이터를 불러오는 중이거나, 데이터가 없습니다.</p>
                <p className="text-sm">Google Sheets 동기화를 시도하거나 Classification CSV 파일을 업로드해주세요.</p>
            </div>
        )}
        
        <div className="mt-6 flex justify-end">
            <button 
                onClick={resetConfig}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors shadow-sm text-sm"
            >
                <RotateCcw className="w-4 h-4" />
                기본값으로 초기화
            </button>
        </div>
      </div>
      <style>{`
        details > summary::-webkit-details-marker { display: none; }
        details[open] .details-arrow { transform: rotate(180deg); }
      `}</style>
    </details>
  );
};