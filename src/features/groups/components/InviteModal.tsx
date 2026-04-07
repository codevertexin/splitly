import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, Check, Loader2, Link as LinkIcon, MessageCircle, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '../../../components/ui/Button';
import { trackProductEvent } from '../../../lib/productTracking';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteLink: string | null;
  loading: boolean;
  error: string | null;
}

export function InviteModal({ isOpen, onClose, inviteLink, loading, error }: InviteModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      // Funnel: user copied invite link to share group.
      void trackProductEvent('invite_link_copied');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const whatsappShareUrl = inviteLink
    ? `https://wa.me/?text=${encodeURIComponent(`${t('inviteModal.shareText')} ${inviteLink}`)}`
    : '#';
  const mailtoUrl = inviteLink
    ? `mailto:?subject=${encodeURIComponent(t('inviteModal.shareTitle'))}&body=${encodeURIComponent(
        `${t('inviteModal.shareText')}\n\n${inviteLink}`,
      )}`
    : '#';
  const handleShareWhatsApp = () => {
    if (!inviteLink) return;
    // Funnel: user chose an explicit share action from invite modal.
    void trackProductEvent('invite_share_clicked', { metadata: { channel: 'whatsapp' } });
    window.open(whatsappShareUrl, '_blank', 'noopener,noreferrer');
  };
  const handleSendEmail = () => {
    if (!inviteLink) return;
    // Funnel: user chose an explicit share action from invite modal.
    void trackProductEvent('invite_share_clicked', { metadata: { channel: 'email' } });
    window.location.href = mailtoUrl;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">{t('inviteModal.title')}</h3>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
                  <p className="text-slate-500 font-medium">{t('inviteModal.generating')}</p>
                </div>
              ) : error ? (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-center">
                  <p className="text-red-600 font-medium mb-4">{error}</p>
                  <Button onClick={onClose} variant="outline" className="w-full">{t('inviteModal.close')}</Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <LinkIcon className="w-8 h-8 text-blue-600" />
                    </div>
                    <p className="text-slate-500 text-sm">{t('inviteModal.shareHint')}</p>
                    <p className="mt-2 text-sm font-medium text-emerald-700">{t('inviteModal.readySuccess')}</p>
                  </div>

                  <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-2xl">
                    <input 
                      type="text" 
                      readOnly 
                      value={inviteLink || ''} 
                      className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-mono text-slate-600 px-2"
                    />
                    <Button 
                      onClick={handleCopy} 
                      size="sm" 
                      variant={copied ? "success" : "secondary"}
                      className="shrink-0"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Button onClick={handleCopy} variant="outline" className="w-full">
                      <Copy className="w-4 h-4 mr-2" />
                      {copied ? t('inviteModal.copied') : t('inviteModal.copyLink')}
                    </Button>
                    <Button
                      onClick={handleShareWhatsApp}
                      className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white"
                      disabled={!inviteLink}
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      {t('inviteModal.shareWhatsApp')}
                    </Button>
                    <Button onClick={handleSendEmail} variant="secondary" className="w-full" disabled={!inviteLink}>
                      <Mail className="w-4 h-4 mr-2" />
                      {t('inviteModal.sendEmail')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
