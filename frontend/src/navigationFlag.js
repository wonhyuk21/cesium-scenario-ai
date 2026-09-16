// 브라우저의 뒤로가기/앞으로가기로 이동했는지 기록해두는 플래그
let cameFromBrowserHistory = false

window.addEventListener('popstate', () => {
    cameFromBrowserHistory = true
})

export function checkAndResetHistoryFlag() {
    const result = cameFromBrowserHistory
    cameFromBrowserHistory = false
    return result
}