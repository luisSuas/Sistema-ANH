import React, { useState } from 'react';
import EstudianteList from './EstudianteList';
import EstudianteForm from './EstudianteForm';

const EstudianteApp = () => {
    const [selectedEstudiante, setSelectedEstudiante] = useState(null);

    const handleSuccess = () => {
        console.log("Estudiante guardado exitosamente");
    };

    const handleEdit = (id) => {
        setSelectedEstudiante(id); 
    };

    return (
        <div>
            <h1>Gestión de Estudiantes</h1>
            <EstudianteForm idEstudiante={selectedEstudiante} onSuccess={handleSuccess} />
            <EstudianteList onEdit={handleEdit} />
        </div>
    );
};

export default EstudianteApp;
