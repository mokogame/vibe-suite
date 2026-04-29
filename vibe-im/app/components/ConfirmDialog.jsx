export default function ConfirmDialog({
  title = "确认操作",
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel
}) {
  return (
    <div className="modalBackdrop" onMouseDown={onCancel}>
      <div className="confirmDialog" onMouseDown={event => event.stopPropagation()}>
        <div>
          <h3>{title}</h3>
          {message && <p>{message}</p>}
        </div>
        <div className="confirmActions">
          <button className="secondaryButton" type="button" onClick={onCancel}>{cancelText}</button>
          <button className={danger ? "dangerButton" : "primaryButton"} type="button" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
