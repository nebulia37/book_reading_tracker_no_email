
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Volume, VolumeStatus, AppView, ClaimRequest } from './types';
import { dbService } from './dbService';
import { generateBlessingMessage } from './geminiService';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('home');
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<VolumeStatus | 'all'>('all');
  const [selectedVolume, setSelectedVolume] = useState<Volume | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{ volume: Volume; blessing: string; sentViaBackend: boolean } | null>(null);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

  // Scripture page state
  const [scriptureHtml, setScriptureHtml] = useState<string>('');
  const [scriptureLoading, setScriptureLoading] = useState(false);
  const [scriptureError, setScriptureError] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    plannedDays: 1,
    remarks: ''
  });

  // Function to load scripture content
  const loadScripture = async (scroll: number) => {
    setScriptureLoading(true);
    setScriptureError('');
    setScriptureHtml('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/scripture/${scroll}`);
      if (!response.ok) {
        throw new Error(`Failed to load scripture: ${response.status}`);
      }
      const data = await response.json();
      const normalizeScriptureHtml = (html: string) => {
        // Upstream nests punctuation inside the hanzi span:
        //   <i><span>pinyin</span><span>hanzi<span class=dou>，</span></span></i>
        // Extract punctuation into its own <i> block with empty pinyin for baseline alignment
        return html.replace(
          /<span class=(?:["'])?(?:dou|dian)(?:["'])?>([^<]*)<\/span>(<\/span><\/i>)/gi,
          '$2<i><span>\u00a0</span><span>$1</span></i>'
        );
      };
      setScriptureHtml(normalizeScriptureHtml(data.html));
    } catch (error: any) {
      console.error('Failed to load scripture:', error);
      setScriptureError(error.message || 'Failed to load scripture text');
    } finally {
      setScriptureLoading(false);
    }
  };

  // Navigate to scripture page
  const goToScripture = (volume: Volume) => {
    setSelectedVolume(volume);
    setView('scripture');
    loadScripture(volume.scroll);
  };

  // Extract unique name-phone pairs from claimed volumes for autocomplete
  const knownClaimers = useMemo(() => {
    const claimersMap = new Map<string, string>();
    volumes.forEach(v => {
      if (v.claimerName && v.claimerPhone) {
        claimersMap.set(v.claimerName, v.claimerPhone);
      }
    });
    return Array.from(claimersMap.entries()).map(([name, phone]) => ({ name, phone }));
  }, [volumes]);

  // Filter suggestions based on input
  const nameSuggestions = useMemo(() => {
    if (!formData.name.trim()) return [];
    return knownClaimers.filter(c =>
      c.name.toLowerCase().includes(formData.name.toLowerCase())
    ).slice(0, 5);
  }, [formData.name, knownClaimers]);

  const handleNameSelect = (name: string, phone: string) => {
    setFormData({ ...formData, name, phone });
    setShowNameSuggestions(false);
  };

  useEffect(() => {
    const loadVolumes = async () => {
      console.log('Loading volumes from dbService...');
      const loadedVolumes = await dbService.getVolumes();
      console.log('Loaded volumes:', loadedVolumes.filter(v => v.status !== VolumeStatus.UNCLAIMED).length, 'claimed');
      setVolumes(loadedVolumes);
    };
    loadVolumes();
  }, []);

  const filteredVolumes = useMemo(() => {
    return volumes.filter(v => {
      const matchesSearch = v.volumeTitle.includes(searchTerm) || v.volumeNumber.includes(searchTerm);
      const matchesFilter = filterStatus === 'all' || v.status === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [volumes, searchTerm, filterStatus]);

  const handleClaimClick = (volume: Volume) => {
    if (volume.status !== VolumeStatus.UNCLAIMED) {
      alert('该卷已经被认领');
      return;
    }
    setSelectedVolume(volume);
    setView('claim');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVolume) return;
    if (formData.phone.length < 8 || formData.phone.length > 11) {
      alert('请输入8-11位手机号');
      return;
    }

    setIsSubmitting(true);
    let sentViaBackend = false;

    try {
      const claimRequest: ClaimRequest = {
        volumeId: selectedVolume.id,
        part: selectedVolume.part,
        scroll: selectedVolume.scroll,
        volumeNumber: selectedVolume.volumeNumber,
        volumeTitle: selectedVolume.volumeTitle,
        readingUrl: selectedVolume.readingUrl,
        ...formData
      };

      const response = await fetch(`${API_BASE_URL}/api/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(claimRequest)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 409) {
          alert(errorData.error || '该卷已经被认领');
          const refreshedVolumes = await dbService.getVolumes();
          setVolumes(refreshedVolumes);
          setView('home');
          return;
        }
        throw new Error(errorData.error || `Backend returned ${response.status}`);
      }

      await response.json();
      sentViaBackend = true;

      const updated = dbService.claimVolume(claimRequest);

      if (updated) {
        setVolumes(prev => prev.map(v => v.id === updated.id ? updated : v));
        const blessing = await generateBlessingMessage(updated.volumeTitle, updated.claimerName || '同修');
        setSuccessData({ volume: updated, blessing, sentViaBackend });
        setView('success');
      } else {
        throw new Error('Failed to update local volume data');
      }
    } catch (error: any) {
      console.error('Claim error:', error);
      alert(error.message || '认领失败，请重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (volume: Volume) => {
    switch (volume.status) {
      case VolumeStatus.UNCLAIMED:
        return <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-400">待认领</span>;
      case VolumeStatus.CLAIMED:
        return <span className="px-3 py-1 text-xs font-bold rounded-full bg-amber-50 text-amber-600">已认领 - {volume.claimerName}</span>;
      case VolumeStatus.COMPLETED:
        return <span className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-600">已完成 - {volume.claimerName}</span>;
    }
  };

  return (
    <div className="min-h-screen py-4 md:py-8 px-3 md:px-12 bg-[#fdfbf7]">
      <header className="max-w-7xl mx-auto mb-6 md:mb-12 text-center fade-in">
        <h1 className="text-3xl md:text-6xl font-bold serif-title text-[#5c4033] mb-4 md:mb-6 tracking-tight">
          名著<span className="text-[#8b7355]">诵读认领</span>
        </h1>
        <div className="w-16 md:w-24 h-1 bg-[#8b7355] mx-auto mb-4 md:mb-6 rounded-full opacity-30"></div>
      </header>

      <main className="max-w-7xl mx-auto sutra-card rounded-3xl overflow-hidden fade-in" style={{ animationDelay: '0.1s' }}>

        {view === 'home' && (
          <div className="flex flex-col">
            {/* Search & Filter Bar */}
            <div className="p-6 bg-[#fcfaf7] border-b border-[#ede3d4] flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-96">
                <input
                  type="text"
                  placeholder="搜索名称或卷号..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#8b7355] transition-all"
                />
                <svg className="w-5 h-5 absolute left-3 top-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1">
                {(['all', VolumeStatus.UNCLAIMED, VolumeStatus.CLAIMED, VolumeStatus.COMPLETED] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${filterStatus === s ? 'bg-[#8b7355] text-white shadow-md' : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'}`}
                  >
                    {s === 'all' ? '全部卷册' : s === VolumeStatus.UNCLAIMED ? '待认领' : s === VolumeStatus.CLAIMED ? '已认领' : '已完成'}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="block md:hidden">
              {filteredVolumes.map((vol) => (
                <div key={vol.id} className="p-4 border-b border-[#ede3d4] bg-white">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="text-xs text-gray-500 mb-1">{vol.volumeNumber}</div>
                      <h3 className="font-bold text-[#5c4033] serif-title text-base mb-2">{vol.volumeTitle}</h3>
                      <div className="mb-2">{getStatusBadge(vol)}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => goToScripture(vol)}
                      className="flex-1 text-center py-3 px-4 border-2 border-blue-600 text-blue-600 rounded-xl font-bold text-sm transition-all active:scale-95"
                    >
                      阅读原文
                    </button>
                    {vol.status === VolumeStatus.UNCLAIMED ? (
                      <button
                        onClick={() => handleClaimClick(vol)}
                        className="flex-1 bg-[#8b7355] text-white py-3 px-4 rounded-xl font-bold text-sm active:scale-95"
                      >
                        我要认领
                      </button>
                    ) : (
                      <div className="flex-1 bg-gray-100 text-gray-400 py-3 px-4 rounded-xl font-bold text-sm text-center cursor-not-allowed">
                        已认领
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {filteredVolumes.length === 0 && (
                <div className="p-20 text-center text-gray-400 font-serif italic text-lg">
                  未找到符合条件的。
                </div>
              )}
            </div>

            {/* Desktop Table View - Essential columns only */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#fcfaf7]">
                  <tr className="text-xs uppercase tracking-widest text-[#8b7355] font-bold">
                    <th className="p-5 border-b border-[#ede3d4]">卷编号</th>
                    <th className="p-5 border-b border-[#ede3d4]">名称</th>
                    <th className="p-5 border-b border-[#ede3d4]">状态</th>
                    <th className="p-5 border-b border-[#ede3d4]">在线阅读</th>
                    <th className="p-5 border-b border-[#ede3d4] text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1e9db]">
                  {filteredVolumes.map((vol) => (
                    <tr key={vol.id} className={`transition-colors group ${vol.status === VolumeStatus.CLAIMED ? 'bg-[#fdfbf7]' : 'hover:bg-[#fdfbf7]'}`}>
                      <td className="p-5 font-mono font-bold text-[#5c4033]">{vol.volumeNumber}</td>
                      <td className="p-5 font-bold text-[#5c4033] serif-title text-lg">{vol.volumeTitle}</td>
                      <td className="p-5">{getStatusBadge(vol)}</td>
                      <td className="p-5">
                        <button
                          onClick={() => goToScripture(vol)}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-bold text-sm transition-colors group-hover:underline"
                        >
                          阅读原文
                          <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </button>
                      </td>
                      <td className="p-5 text-center">
                        {vol.status === VolumeStatus.UNCLAIMED ? (
                          <button
                            onClick={() => handleClaimClick(vol)}
                            className="bg-[#8b7355] hover:bg-[#5c4033] text-white px-6 py-2 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 transform hover:-translate-y-0.5"
                          >
                            我要认领
                          </button>
                        ) : (
                          <span className="bg-gray-100 text-gray-400 px-6 py-2 rounded-xl text-sm font-bold cursor-not-allowed">
                            已认领
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredVolumes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-20 text-center text-gray-400 font-serif italic text-lg">
                        未找到符合条件的。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'claim' && selectedVolume && (
          <div className="p-4 md:p-16 max-w-4xl mx-auto fade-in">
            <button
              onClick={() => setView('home')}
              className="mb-6 md:mb-8 text-[#8b7355] hover:text-[#5c4033] flex items-center font-bold transition-colors text-base md:text-lg active:scale-95"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              返回名著列表
            </button>

            <form onSubmit={handleSubmit} className="space-y-6 md:space-y-8">
              <div className="bg-[#fdfbf7] p-4 md:p-8 rounded-3xl border border-[#ede3d4] shadow-inner">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                  <div>
                    <label className="block text-xs font-bold text-[#8b7355] uppercase tracking-widest mb-2">认领卷册</label>
                    <p className="text-2xl font-bold text-[#5c4033] serif-title">{selectedVolume.volumeNumber} {selectedVolume.volumeTitle}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                <div className="relative">
                  <label className="block text-sm font-bold text-gray-700 mb-1">您的姓名 <span className="text-red-500">*</span></label>
                  <p className="text-xs text-gray-500 mb-2">请使用faming或者常用名，方便义工联系</p>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({...formData, name: e.target.value});
                      setShowNameSuggestions(true);
                    }}
                    onFocus={() => setShowNameSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
                    className="w-full px-4 md:px-5 py-3 md:py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-[#8b73551a] outline-none transition-all text-base md:text-lg"
                    placeholder=""
                    autoComplete="off"
                  />
                  {showNameSuggestions && nameSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {nameSuggestions.map((suggestion, idx) => (
                        <div
                          key={idx}
                          className="px-4 py-3 hover:bg-[#fdfbf7] cursor-pointer border-b border-gray-100 last:border-b-0"
                          onMouseDown={() => handleNameSelect(suggestion.name, suggestion.phone)}
                        >
                          <div className="font-medium text-[#5c4033]">{suggestion.name}</div>
                          <div className="text-xs text-gray-400">{suggestion.phone.slice(0, 3)}****{suggestion.phone.slice(-4)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">联系手机 <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="tel"
                    pattern="[0-9]{8,11}"
                    minLength={8}
                    maxLength={11}
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 11)})}
                    className="w-full px-4 md:px-5 py-3 md:py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-[#8b73551a] outline-none transition-all text-base md:text-lg"
                    placeholder="13800000000"
                    title="请输入8-11位手机号码"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">计划诵读周期 <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select
                      required
                      value={formData.plannedDays}
                      onChange={(e) => setFormData({...formData, plannedDays: parseInt(e.target.value)})}
                      className="w-full px-4 md:px-5 py-3 md:py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-[#8b73551a] outline-none transition-all text-base md:text-lg appearance-none bg-white"
                    >
                      <option value="1">1天</option>
                      <option value="3">3天</option>
                      <option value="7">7天</option>
                    </select>
                    <svg className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">备注</label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                  rows={3}
                  className="w-full px-4 md:px-5 py-3 md:py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-[#8b73551a] outline-none transition-all text-base md:text-lg resize-none"
                  placeholder="选填：可以添加您的期望、祈愿或其他说明..."
                />
              </div>

              <div className="pt-6 md:pt-10">
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className={`w-full py-4 md:py-5 rounded-2xl font-bold text-lg md:text-2xl transition-all shadow-2xl flex items-center justify-center transform active:scale-[0.98] ${isSubmitting ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#5c4033] hover:bg-[#3d2b22] text-white md:hover:-translate-y-1'}`}
                >
                  {isSubmitting ? (
                    <div className="flex items-center">
                      <svg className="animate-spin h-6 w-6 mr-3 text-gray-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      正在递交...
                    </div>
                  ) : '发起诵读认领'}
                </button>
              </div>
            </form>
          </div>
        )}

        {view === 'success' && successData && (
          <div className="p-6 md:p-20 text-center fade-in">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 md:mb-10 shadow-inner">
              <svg className="w-12 h-12 md:w-16 md:h-16 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl md:text-5xl font-bold serif-title text-[#5c4033] mb-4 md:mb-6">认领誓愿已成</h2>

            <div className="bg-[#fcfaf7] border-2 border-[#ede3d4] rounded-3xl p-6 md:p-10 mb-8 md:mb-12 shadow-sm relative overflow-hidden text-left">
              <h3 className="font-bold text-[#8b7355] mb-4 md:mb-8 text-xl md:text-3xl serif-title calligraphy">诸佛加持 · 随喜赞叹</h3>
              <p className="text-gray-700 italic text-base md:text-2xl font-serif mb-6 md:mb-10 border-l-4 md:border-l-8 border-[#8b7355] pl-4 md:pl-8 leading-relaxed">
                "{successData.blessing}"
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8 bg-white p-4 md:p-8 rounded-2xl border border-gray-100 shadow-inner">
                <div>
                  <label className="text-xs text-gray-400 uppercase font-bold tracking-widest block mb-2">认领经目</label>
                  <p className="font-bold text-gray-800 text-base md:text-xl serif-title">{successData.volume.volumeTitle}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase font-bold tracking-widest block mb-2">圆满截止日期</label>
                  <p className="font-bold text-blue-600 text-lg md:text-2xl">
                    {(() => {
                      try {
                        const date = new Date(successData.volume.expectedCompletionDate!);
                        return isNaN(date.getTime()) ? '日期计算中...' : date.toLocaleDateString();
                      } catch {
                        return '日期计算中...';
                      }
                    })()}
                  </p>
                </div>
              </div>

              <button
                onClick={() => goToScripture(successData.volume)}
                className="mt-6 md:mt-10 block w-full bg-[#8b7355] hover:bg-[#5c4033] text-white py-4 md:py-5 rounded-2xl font-bold text-center text-base md:text-xl transition-all shadow-2xl transform active:scale-95 md:hover:-translate-y-1"
              >
                开始诵读经文
              </button>
            </div>

            <button onClick={() => setView('home')} className="text-[#8b7355] hover:text-[#5c4033] font-bold transition-colors text-base md:text-lg flex items-center justify-center mx-auto active:scale-95">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7"/></svg>
              返回经目列表
            </button>
          </div>
        )}

        {view === 'scripture' && selectedVolume && (
          <div className="p-4 md:p-8 fade-in">
            <button
              onClick={() => setView('home')}
              className="mb-6 text-[#8b7355] hover:text-[#5c4033] flex items-center font-bold transition-colors text-base active:scale-95"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              返回经目列表
            </button>

            {/* Scripture Header */}
            <div className="bg-[#fdfbf7] p-6 md:p-8 rounded-2xl border border-[#ede3d4] mb-6">
              <h2 className="text-2xl md:text-4xl font-bold serif-title text-[#5c4033] mb-4">
                {selectedVolume.volumeTitle}
              </h2>
              <p className="text-sm text-gray-500 mb-4">{selectedVolume.volumeNumber}</p>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                {/* Audio Player */}
                <div className="flex-1 min-w-[280px]">
                  <label className="block text-xs font-bold text-[#8b7355] uppercase tracking-widest mb-2">
                    人声朗读
                  </label>
                  <audio
                    ref={audioRef}
                    controls
                    className="w-full"
                    src={`https://w1.xianmijingzang.com/fojing/1/1/1/1_${selectedVolume.scroll}.mp3?_mt=`}
                  >
                    Your browser does not support the audio element.
                  </audio>
                  <div className="flex gap-2 mt-2">
                    <a
                      href={`https://w1.xianmijingzang.com/fojing/1/1/1/1_${selectedVolume.scroll}.mp3?_mt=`}
                      download
                      className="inline-flex items-center px-4 py-2 border-2 border-[#8b7355] text-[#8b7355] hover:bg-[#f5f0eb] rounded-xl font-bold text-sm transition-all"
                    >
                      下载
                    </a>
                    <button
                      onClick={() => {
                        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
                        const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
                        const next = speeds[nextIdx];
                        setPlaybackSpeed(next);
                        if (audioRef.current) audioRef.current.playbackRate = next;
                      }}
                      className="inline-flex items-center px-4 py-2 border-2 border-[#8b7355] text-[#8b7355] hover:bg-[#f5f0eb] rounded-xl font-bold text-sm transition-all"
                    >
                      倍数 {playbackSpeed}x
                    </button>
                  </div>
                </div>

                {/* Download Options */}
                <div>
                  <label className="block text-xs font-bold text-[#8b7355] uppercase tracking-widest mb-2">
                    下载经文
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => window.open(`${API_BASE_URL}/api/scripture/${selectedVolume.scroll}/pdf`, '_blank')}
                      className="inline-flex items-center px-4 py-3 border-2 border-[#5c4033] text-[#5c4033] hover:bg-[#f5f0eb] rounded-xl font-bold text-sm transition-all"
                    >
                      <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      PDF
                    </button>
                  </div>
                </div>

                {/* External Link */}
                <div>
                  <label className="block text-xs font-bold text-[#8b7355] uppercase tracking-widest mb-2">
                    原始来源
                  </label>
                  <a
                    href={selectedVolume.readingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-6 py-3 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 rounded-xl font-bold text-sm transition-all"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    原文链接
                  </a>
                </div>
              </div>
            </div>

            {/* Scripture Content */}
            <div className="bg-white rounded-2xl border border-[#ede3d4] p-6 md:p-10 shadow-sm">
              <h3 className="text-xl font-bold text-[#5c4033] mb-6 pb-4 border-b border-[#ede3d4]">
                经文内容
              </h3>

              {scriptureLoading && (
                <div className="flex items-center justify-center py-20">
                  <svg className="animate-spin h-10 w-10 text-[#8b7355]" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="ml-4 text-gray-500 text-lg">正在加载经文...</span>
                </div>
              )}

              {scriptureError && (
                <div className="text-center py-20">
                  <div className="text-red-500 mb-4">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-lg font-medium">{scriptureError}</p>
                  </div>
                  <button
                    onClick={() => loadScripture(selectedVolume.scroll)}
                    className="px-6 py-3 bg-[#8b7355] hover:bg-[#5c4033] text-white rounded-xl font-bold transition-all"
                  >
                    重试
                  </button>
                </div>
              )}

              {!scriptureLoading && !scriptureError && scriptureHtml && (
                <div
                  className="scripture-content"
                  dangerouslySetInnerHTML={{ __html: scriptureHtml }}
                />
              )}

              {!scriptureLoading && !scriptureError && !scriptureHtml && (
                <div className="text-center py-20 text-gray-400">
                  <p>经文内容为空</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto mt-20 text-center pb-12">
        <div className="flex items-center justify-center space-x-4 mb-4 opacity-40">
           <div className="w-12 h-px bg-[#8b7355]"></div>
           <svg className="w-6 h-6 text-[#8b7355]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
           <div className="w-12 h-px bg-[#8b7355]"></div>
        </div>
        <p className="text-gray-400 text-sm mb-2">© {new Date().getFullYear()} 阅读平台</p>
        <button
          onClick={() => { if(confirm('重置系统将清除所有本地认领记录，确定吗？')) dbService.reset(); }}
          className="text-[10px] text-gray-300 hover:text-red-400 underline transition-colors mt-2"
        >
          系统调试：清除缓存并重置数据
        </button>
      </footer>
    </div>
  );
};

export default App;
