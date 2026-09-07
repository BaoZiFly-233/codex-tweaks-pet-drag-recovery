import './style.css';

const phases = {
  starting: '正在启动恢复服务', waiting: '等待宠物浮窗出现', watching: '正在守护新窗口',
  paused: '自动恢复已暂停', settling: '等待窗口稳定或冷却结束', input_busy: '等待鼠标按键松开',
  desktop_unavailable: '桌面暂不可操作，已暂停处理', ambiguous: '发现多个浮窗，请先隐藏其他宠物或语音浮窗',
  repairing: '正在重置窗口，约需 3 秒', error: '恢复已停止，请查看错误',
  stopped: '恢复服务已停止', unsupported: '仅支持 Windows Store 版客户端',
};

export function activate({ node, ui, onCleanup }) {
  if (!node) return;
  let state = { phase: 'starting', automatic: true };
  const views = new Set();
  let disposed = false;
  const render = value => { if (!disposed) { state = value; for (const view of views) view(value); } };
  const unsubscribe = node.on('status', render);
  const refresh = () => node.invoke('status', {}).then(render).catch(error => render({ ...state, phase: 'error', error: error.message }));
  void refresh();
  const registration = ui?.settingsSections?.register({
    id: 'pet-drag-recovery',
    mount(container) {
      let mounted = true;
      const page = document.createElement('section');
      page.className = 'ct-pet-drag-recovery';
      page.innerHTML = `<h2>宠物拖动恢复</h2>
        <p>自动处理新出现的宠物浮窗。若同一窗口再次拖不动，可手动恢复。</p>
        <label class="ct-pet-drag-recovery-option"><input type="checkbox"> 自动恢复新窗口</label>
        <p class="ct-pet-drag-recovery-status" role="status" aria-live="polite"></p>
        <button type="button">立即恢复</button>
        <p class="ct-pet-drag-recovery-detail"></p>
        <p class="ct-pet-drag-recovery-error" role="alert"></p>
        <p class="ct-pet-drag-recovery-note">执行时请松开鼠标，等待约 3 秒，完成后拖动确认效果。使用语音浮窗时可暂停自动恢复，避免处理语音窗口。</p>`;
      const checkbox = page.querySelector('input');
      const button = page.querySelector('button');
      const status = page.querySelector('[role="status"]');
      const detail = page.querySelector('.ct-pet-drag-recovery-detail');
      const alert = page.querySelector('[role="alert"]');
      let requesting = false, requestError = '';
      const update = value => {
        if (!mounted) return;
        checkbox.checked = value.automatic ?? false;
        checkbox.disabled = requesting || value.phase === 'unsupported';
        button.disabled = requesting || value.phase === 'repairing' || value.phase === 'unsupported';
        status.textContent = phases[value.phase] || value.phase;
        detail.textContent = value.lastReset
          ? `上次窗口重置：${new Date(value.lastReset.at).toLocaleString()}。原始样式已完整恢复；实际拖动效果需确认。`
          : '尚未执行窗口重置。';
        alert.textContent = requestError || value.error || '';
      };
      const invoke = async (method, payload) => {
        requesting = true; requestError = ''; update(state);
        try { render(await node.invoke(method, payload)); }
        catch (error) { requestError = String(error.message || error); }
        finally { requesting = false; if (mounted) update(state); }
      };
      const onChange = () => { void invoke('set-automatic', { enabled: checkbox.checked }); };
      const onClick = () => { void invoke('repair', {}); };
      checkbox.addEventListener('change', onChange);
      button.addEventListener('click', onClick);
      views.add(update); update(state);
      container.append(page);
      void refresh();
      return () => {
        if (!mounted) return;
        mounted = false; views.delete(update);
        checkbox.removeEventListener('change', onChange); button.removeEventListener('click', onClick);
        page.remove();
      };
    },
  });
  onCleanup(() => { disposed = true; unsubscribe(); registration?.unregister(); views.clear(); });
}
