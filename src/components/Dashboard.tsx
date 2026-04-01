import React, { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Group } from '../types';
import { 
  Plus, 
  Users, 
  LogOut, 
  Loader2,
  ChevronRight,
  AlertCircle,
  Receipt,
  ArrowLeft,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrandLogo } from './BrandLogo';
import { formatCurrencyCents } from '../lib/dateTime';

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const zeroAmount = formatCurrencyCents(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [isRestored, setIsRestored] = useState(false);

  // Persistence: Load last selected group from localStorage only once
  useEffect(() => {
    if (isRestored || groups.length === 0) return;
    
    const savedGroupId = localStorage.getItem('splitly_last_group_id');
    if (savedGroupId) {
      const group = groups.find(g => g.id === savedGroupId);
      if (group) {
        setSelectedGroup(group);
      }
    }
    setIsRestored(true);
  }, [groups, isRestored]);

  // Persistence: Save selected group to localStorage
  const handleSetSelectedGroup = (group: Group | null) => {
    setSelectedGroup(group);
    if (group) {
      localStorage.setItem('splitly_last_group_id', group.id);
    } else {
      localStorage.removeItem('splitly_last_group_id');
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGroups(data || []);
    } catch (err: any) {
      console.error('Error fetching groups:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('create-group', {
        body: { name: newGroupName, description: newGroupDesc },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (funcError) throw funcError;

      await fetchGroups();
      setNewGroupName('');
      setNewGroupDesc('');
      setSuccess(true);
      setShowCreateForm(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem('splitly_last_group_id');
    await supabase.auth.signOut();
  };

  const handleSettleUp = async () => {
    setActionLoading(true);
    try {
      // Simulate settling up for now as there's no real backend for it yet
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSuccess(true);
      setShowSettleConfirm(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to settle up');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            {selectedGroup && (
              <button 
                onClick={() => handleSetSelectedGroup(null)}
                className="p-2 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-900 rounded-xl border border-slate-100 transition-all shadow-sm"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => handleSetSelectedGroup(null)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <BrandLogo className="h-11 sm:h-12 w-auto max-w-[12rem] sm:max-w-[15rem]" />
            </button>
          </div>
          <button 
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        <AnimatePresence mode="wait">
          {!selectedGroup ? (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden"
            >
              <div className="p-8 border-b border-slate-50">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-slate-900">My Groups</h2>
                  {!showCreateForm && (
                    <button 
                      onClick={() => setShowCreateForm(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
                    >
                      <Plus className="w-4 h-4" />
                      New Group
                    </button>
                  )}
                </div>
                
                <AnimatePresence>
                  {showCreateForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <form onSubmit={handleCreateGroup} className="space-y-4 mb-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 ml-1">Group Name</label>
                            <input
                              type="text"
                              required
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                              placeholder="e.g. Ski Trip 2024"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 ml-1">Description (Optional)</label>
                            <input
                              type="text"
                              value={newGroupDesc}
                              onChange={(e) => setNewGroupDesc(e.target.value)}
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                              placeholder="Shared expenses for..."
                            />
                          </div>
                        </div>

                        {error && (
                          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                          </div>
                        )}

                        {success && (
                          <div className="p-3 bg-green-50 text-green-600 text-xs rounded-xl border border-green-100">
                            Group created successfully!
                          </div>
                        )}

                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setShowCreateForm(false)}
                            className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={actionLoading}
                            className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-blue-100"
                          >
                            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Plus className="w-5 h-5" /> Create Group</>}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="p-8 bg-slate-50/30">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Your Active Groups</h3>
                
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                  </div>
                ) : groups.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Users className="w-6 h-6 text-slate-300" />
                    </div>
                    <p className="text-slate-500 text-sm">No groups found. Create one above to get started!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groups.map((group) => (
                      <motion.div 
                        key={group.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => handleSetSelectedGroup(group)}
                        className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                            <Users className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{group.name}</h4>
                            <p className="text-slate-400 text-xs line-clamp-1">{group.description || 'No description'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-green-600">{zeroAmount}</span>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="group-detail"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between gap-4 mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{selectedGroup.name}</h2>
                      <p className="text-slate-500 text-sm">{selectedGroup.description || 'No description'}</p>
                    </div>
                  </div>
                  
                  {!showSettleConfirm && (
                    <button 
                      onClick={() => setShowSettleConfirm(true)}
                      className="hidden sm:flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition-all shadow-md shadow-green-100"
                    >
                      <Check className="w-4 h-4" />
                      Settle Up
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {showSettleConfirm && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center gap-3 p-4 bg-green-50 rounded-2xl border border-green-100 mb-8"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-bold text-green-900">Confirm Settle Up?</p>
                        <p className="text-xs text-green-700">This will mark all debts as settled in this group.</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setShowSettleConfirm(false)}
                          className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl border border-slate-100 transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={handleSettleUp}
                          disabled={actionLoading}
                          className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition-all shadow-md shadow-green-100 flex items-center gap-2"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Mobile Settle Up Button */}
                {!showSettleConfirm && (
                  <button 
                    onClick={() => setShowSettleConfirm(true)}
                    className="sm:hidden w-full mb-8 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition-all shadow-md shadow-green-100"
                  >
                    <Check className="w-4 h-4" />
                    Settle Up
                  </button>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Total Expenses</p>
                    <p className="text-2xl font-bold text-blue-900">{zeroAmount}</p>
                  </div>
                  <div className="bg-green-50 p-6 rounded-2xl border border-green-100">
                    <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Your Balance</p>
                    <p className="text-2xl font-bold text-green-900">{zeroAmount}</p>
                  </div>
                </div>

                <div className="text-center py-20 border-2 border-dashed border-slate-100 rounded-3xl">
                  <Receipt className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-400 font-medium">No expenses recorded in this group yet.</p>
                  <button className="mt-4 px-6 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">
                    Add First Expense
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer info */}
        <p className="mt-8 text-center text-slate-400 text-xs">
          Logged in as <span className="text-slate-600 font-medium">{session.user.email}</span>
        </p>
      </div>
    </div>
  );
}
