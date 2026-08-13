import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function SignUpPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [passwordConfirm, setPasswordConfirm] = useState('')
    const [error, setError] = useState('')
    const navigate = useNavigate()

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if(!username || !password || !passwordConfirm) {
            setError('모든 항목을 입력해주세요.')
            return
        }

        if(password != passwordConfirm) {
            setError('비밀번호가 일치하지 않습니다.')
            return
        }

        try {
            const result = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json '},
                body: JSON.stringify({ username, password }),
            })
            if(!result.ok) {
                const message = await result.text()
                throw new Error(message || '회원가입 실패')
            }

            alert('회원가입이 완료됐습니다. 로그인해주세요.')
            navigate('/')
        } catch (err) {
            setError(err.message || '회원가입에 실패했습니다. 다시 시도해주세요.')
        }
    }
    return (
        <div className="signup-page">
            <h1>Sign Up</h1>
            <form onSubmit={handleSubmit}>
                <input type="text" placeholder="아이디" value={username} onChange={(e) => setUsername(e.target.value)} />
                <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
                <input type="password" placeholder="비밀번호 확인" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
                {error && <p className="error">{error}</p>}
                <button type="submit">회원가입</button>
                <button type="button" onClick={() => navigate('/')}>로그인으로 돌아가기</button>
            </form>
        </div>
    )
}

export default SignUpPage