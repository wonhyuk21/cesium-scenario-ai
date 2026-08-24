import { useState } from 'react'

function DropdownMenu ({ label, children }) {
    const [ isOpen, setIsOpen ] = useState(false)

    return (
        <div className="dropdown-menu">
            <button className="dropdown-trigger" onClick={() => setIsOpen(!isOpen)}></button>
            
        </div>
    )
}