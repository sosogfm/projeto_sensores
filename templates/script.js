

document.getElementById('tipo').addEventListener('change', function() {
    document.getElementById('campos-temperatura').style.display = 'none'
    document.getElementById('campos-umidade').style.display = 'none'
    
    if (this.value === 'temperatura') {
        document.getElementById('campos-temperatura').style.display = 'block'
    } else if (this.value === 'umidade') {
        document.getElementById('campos-umidade').style.display = 'block'
    }
})