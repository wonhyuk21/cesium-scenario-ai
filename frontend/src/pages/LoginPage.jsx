import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function LoginPage() {
    const [id, setId] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const navigate = useNavigate()

    // async 없이는 await fetch를 사용할 수 없음
    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        try {
            const result = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, password }),
            })
            if(!result.ok) throw new Error('로그인 실패')
            const data = await res.json()
            localStorage.setItem('token', data.token)
            // 로그인 성공시 페이지 이동
            navigate('/simulation')
        } catch (err) {
            setError('아이디 또는 비밀번호가 올바르지 않습니다.')
        }
    }

    return (
        <div className="login-page">
            <h1>Login</h1>
            <form onSubmit={handleSubmit}>
                <input type="text" placeholder="아이디" value={id} onChange={(e) => setId(e.target.value)}></input>
                <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)}></input>
                {error && <p className="error">{error}</p>}
                <button type="submit">로그인</button>
            </form>
        </div>
    )
}

export default LoginPage