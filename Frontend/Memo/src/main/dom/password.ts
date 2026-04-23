import {Undef} from "./memo_interfaces.js";

export async function promptPassword(old_value: Undef<string>, message: string = "Enter Password"): Promise<string | undefined> {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');

        // Basic dialog styling
        dialog.style.cssText = `
            padding: 24px; border: none; border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 320px;
            font-family: system-ui, -apple-system, sans-serif;
            background-color: #383838;
            color: white;
        `;

        const style = document.createElement('style');
        style.textContent = `
            dialog::backdrop { background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); }
            .pw-container { position: relative; margin: 15px 0; }
            .btn-group { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
            .btn { background: none; border: none; padding: 0; margin: 0; cursor: pointer; }
        `;
        document.head.appendChild(style);

        dialog.innerHTML = `
            <form method="dialog" autocomplete="off">
                <div style="font-size: 1.1rem;">${message}</div>
                
                <div class="pw-container">
                    <input type="password" id="pw-input" autocomplete="new-password"
                           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;">
                    
                    <span id="pw-toggle" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; line-height: 0;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </span>
                </div>

                <div class="btn-group">
                    <button type="submit" value="cancel" class="btn btn-cancel"><img id="cancel_password" src="/images/ic_clear_48px.svg" alt="Cancel"></button>
                    <button type="submit" value="ok" class="btn btn-ok"><img id="done_password" src="/images/ic_done_48px.svg" alt="Done"></button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);
        const input = dialog.querySelector('#pw-input') as HTMLInputElement;
        const toggle = dialog.querySelector('#pw-toggle') as HTMLElement;
        input.value = old_value || '';

        // Toggle visibility logic
        toggle.onclick = () => {
            input.type = input.type === 'password' ? 'text' : 'password';
        };

        // Listen for the close event
        dialog.addEventListener('close', () => {
            const result = dialog.returnValue === 'ok' ? input.value : undefined;
            dialog.remove();
            style.remove();
            resolve(result);
        });

        // Trigger the modal
        dialog.showModal();
    });
}